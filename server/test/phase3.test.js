// Automated test of Phase 3: the request/approval flow and chat. Run with: npm test   (from /server)
import { assert, createRunner, makeClient, sleep, startServer } from './helpers.js';

const { test, finish } = createRunner();

async function main() {
  const { base, stop } = await startServer();
  console.log(`Testing server at ${base}\n`);

  const host = makeClient(base, 'host-session-1');
  const mod = makeClient(base, 'mod-session-001');
  const alice = makeClient(base, 'alice-session-1');
  const bob = makeClient(base, 'bob-session-001');
  const clients = [host, mod, alice, bob];

  // Setup: Host creates the room, Mod/Alice/Bob join, Host promotes Mod.
  const first = await host.join(undefined, 'Host');
  const roomId = first.roomId;
  await mod.join(roomId, 'Mod');
  await alice.join(roomId, 'Alice');
  await bob.join(roomId, 'Bob');
  host.emit('assign_role', { userId: 'mod-session-001', role: 'moderator' });
  await mod.waitFor('role_assigned', (p) => p.role === 'moderator');
  // A new room has no video, so the Host picks one first (this also lets play/seek requests work).
  host.emit('change_video', { videoId: 'dQw4w9WgXcQ' });
  await host.waitFor('sync_state', (p) => p.videoId === 'dQw4w9WgXcQ');
  console.log(`Room ${roomId}: Host, Mod (moderator), Alice and Bob (participants)\n`);

  // ---------- request / approval ----------

  await test('Participant request_action(seek) is acked and reaches Host and Moderator only', async () => {
    const [mh, mm, ma, mb] = [host.mark(), mod.mark(), alice.mark(), bob.mark()];
    const ack = await alice.emitAck('request_action', { type: 'seek', payload: { time: 42 } });
    assert(ack.ok && ack.requestId, `ack was ${JSON.stringify(ack)}`);
    const forHost = await host.waitFor('request_pending', () => true, mh);
    const forMod = await mod.waitFor('request_pending', () => true, mm);
    assert(forHost.request.id === ack.requestId && forMod.request.id === ack.requestId, 'request ids differ');
    assert(forHost.request.username === 'Alice' && forHost.request.payload.time === 42, 'request content wrong');
    await alice.expectNone('request_pending', ma);
    await bob.expectNone('request_pending', mb);
  });

  await test('Play/seek requests are refused while the room has no video', async () => {
    const empty = makeClient(base, 'empty-host-001');
    const other = makeClient(base, 'empty-user-001');
    const room = await empty.join(undefined, 'EmptyHost');
    await other.join(room.roomId, 'EmptyUser');
    const ack = await other.emitAck('request_action', { type: 'seek', payload: { time: 5 } });
    assert(ack.ok === false && /no video/i.test(ack.message), 'got ' + JSON.stringify(ack));
    const ok = await other.emitAck('request_action', { type: 'change_video', payload: { videoId: 'dQw4w9WgXcQ' } });
    assert(ok.ok === true, 'asking for a video must still be allowed');
    empty.socket.close();
    other.socket.close();
  });

  await test('Request does NOT change the video until approved', async () => {
    const m = bob.mark();
    host.emit('pause'); // make sure state is known: paused at some position
    const before = await bob.waitFor('sync_state', (p) => p.playState === 'paused', m);
    assert(Math.abs(before.currentTime - 42) > 1, `video already at 42 (${before.currentTime}), request leaked`);
  });

  await test('Moderator approves -> everyone gets sync_state at 42s and requester gets request_resolved', async () => {
    const pending = host.log.find((e) => e.event === 'request_pending').payload.request;
    const [ma, mb, mh] = [alice.mark(), bob.mark(), host.mark()];
    mod.emit('resolve_request', { requestId: pending.id, approve: true });
    const resolved = await alice.waitFor('request_resolved', (p) => p.requestId === pending.id, ma);
    assert(resolved.approved === true && resolved.resolvedBy === 'Mod' && resolved.requesterId === 'alice-session-1', 'resolved payload wrong');
    const state = await bob.waitFor('sync_state', (p) => Math.abs(p.currentTime - 42) < 1, mb);
    assert(state.playState === 'paused', 'seek should keep the paused state');
    await host.waitFor('request_resolved', (p) => p.requestId === pending.id, mh);
  });

  await test('Rejected request changes nothing and requester is told', async () => {
    const ack = await alice.emitAck('request_action', { type: 'change_video', payload: { videoId: 'dQw4w9WgXcQ' } });
    const [ma, mb] = [alice.mark(), bob.mark()];
    host.emit('resolve_request', { requestId: ack.requestId, approve: false });
    const resolved = await alice.waitFor('request_resolved', (p) => p.requestId === ack.requestId, ma);
    assert(resolved.approved === false && resolved.resolvedBy === 'Host', 'should be rejected by Host');
    await bob.expectNone('sync_state', mb);
  });

  await test('Approved change_video switches the video for everyone', async () => {
    const ack = await bob.emitAck('request_action', { type: 'change_video', payload: { videoId: 'dQw4w9WgXcQ' } });
    const m = alice.mark();
    host.emit('resolve_request', { requestId: ack.requestId, approve: true });
    const state = await alice.waitFor('sync_state', (p) => p.videoId === 'dQw4w9WgXcQ', m);
    assert(state.currentTime < 3, `new video should start near 0, got ${state.currentTime}`);
  });

  await test('Approved play and pause requests apply', async () => {
    let ack = await alice.emitAck('request_action', { type: 'play', payload: {} });
    let m = bob.mark();
    mod.emit('resolve_request', { requestId: ack.requestId, approve: true });
    await bob.waitFor('sync_state', (p) => p.playState === 'playing', m);
    ack = await alice.emitAck('request_action', { type: 'pause', payload: {} });
    m = bob.mark();
    mod.emit('resolve_request', { requestId: ack.requestId, approve: true });
    await bob.waitFor('sync_state', (p) => p.playState === 'paused', m);
  });

  await test('Participant cannot resolve a request (permission error)', async () => {
    const ack = await alice.emitAck('request_action', { type: 'pause', payload: {} });
    const m = bob.mark();
    bob.emit('resolve_request', { requestId: ack.requestId, approve: true });
    const err = await bob.waitFor('error', () => true, m);
    assert(/permission/i.test(err.message), `got "${err.message}"`);
    host.emit('resolve_request', { requestId: ack.requestId, approve: false }); // tidy up
  });

  await test('Host and Moderator cannot use request_action (they act directly)', async () => {
    for (const c of [host, mod]) {
      const m = c.mark();
      c.emit('request_action', { type: 'pause', payload: {} });
      const err = await c.waitFor('error', () => true, m);
      assert(/permission/i.test(err.message), `got "${err.message}"`);
    }
  });

  await test('Invalid request payloads are rejected', async () => {
    const bad = [
      { type: 'seek', payload: { time: -5 } },
      { type: 'seek', payload: { time: 'abc' } },
      { type: 'change_video', payload: { videoId: 'short' } },
      { type: 'delete_everything', payload: {} },
      { type: 'assign_role', payload: { userId: 'alice-session-1', role: 'host' } },
    ];
    for (const payload of bad) {
      const ack = await alice.emitAck('request_action', payload);
      assert(ack?.ok !== true, `accepted ${JSON.stringify(payload)}`);
    }
  });

  await test('Resolving the same request twice is rejected', async () => {
    const ack = await alice.emitAck('request_action', { type: 'pause', payload: {} });
    host.emit('resolve_request', { requestId: ack.requestId, approve: true });
    await sleep(150);
    const m = mod.mark();
    mod.emit('resolve_request', { requestId: ack.requestId, approve: true });
    const err = await mod.waitFor('error', () => true, m);
    assert(/already handled/i.test(err.message), `got "${err.message}"`);
  });

  await test('Unknown request id is rejected', async () => {
    const m = host.mark();
    host.emit('resolve_request', { requestId: 'does-not-exist', approve: true });
    await host.waitFor('error', () => true, m);
  });

  await test('Too many pending requests from one user is blocked (max 5)', async () => {
    const acks = [];
    for (let i = 0; i < 6; i++) acks.push(await bob.emitAck('request_action', { type: 'seek', payload: { time: i } }));
    assert(acks.slice(0, 5).every((a) => a.ok), 'first five should be accepted');
    assert(acks[5].ok === false && /too many/i.test(acks[5].message), `sixth was ${JSON.stringify(acks[5])}`);
  });

  await test("A requester leaving drops their pending requests (request_resolved, rejected)", async () => {
    const m = host.mark();
    bob.socket.emit('leave_room', { roomId });
    const dropped = await host.waitFor('request_resolved', (p) => p.requesterId === 'bob-session-001', m);
    assert(dropped.approved === false && dropped.resolvedBy === null, 'should be dropped as rejected');
  });

  await test('Newly promoted Moderator receives the pending request list', async () => {
    const ack = await alice.emitAck('request_action', { type: 'seek', payload: { time: 77 } });
    const carol = makeClient(base, 'carol-session-1');
    clients.push(carol);
    await carol.join(roomId, 'Carol');
    const m = carol.mark();
    host.emit('assign_role', { userId: 'carol-session-1', role: 'moderator' });
    const list = await carol.waitFor('request_list', () => true, m);
    assert(list.requests.some((r) => r.id === ack.requestId), 'Carol should see Alice\'s earlier request');
    // And a late joiner who is a plain Participant is never sent the list in the join ack.
    const dave = makeClient(base, 'dave-session-1');
    clients.push(dave);
    const joined = await dave.join(roomId, 'Dave');
    assert(joined.requests.length === 0, 'participants must not receive pending requests');
  });

  // ---------- chat ----------

  await test('Chat from a Participant is broadcast to everyone including the sender', async () => {
    const marks = clients.map((c) => c.mark());
    alice.emit('chat_message', { text: '  hello everyone  ' });
    for (const [i, c] of clients.entries()) {
      if (c === bob) continue; // Bob left the room
      const msg = await c.waitFor('chat_message', (p) => p.userId === 'alice-session-1', marks[i]);
      assert(msg.text === 'hello everyone' && msg.username === 'Alice' && msg.timestamp > 0, 'wrong chat payload');
    }
  });

  await test('Empty, whitespace and over-long chat messages are rejected', async () => {
    for (const text of ['', '    ', 'x'.repeat(501), 123]) {
      const m = alice.mark();
      alice.emit('chat_message', { text });
      await alice.waitFor('error', () => true, m);
      await mod.expectNone('chat_message', mod.mark(), 100);
    }
  });

  await test('HTML in chat is passed through as plain text (React escapes it on display)', async () => {
    const m = mod.mark();
    alice.emit('chat_message', { text: '<img src=x onerror=alert(1)>' });
    const msg = await mod.waitFor('chat_message', (p) => p.text.includes('<img'), m);
    assert(msg.text === '<img src=x onerror=alert(1)>', 'text should be stored verbatim');
  });

  await test('A late joiner receives recent chat history in the join ack', async () => {
    const erin = makeClient(base, 'erin-session-1');
    clients.push(erin);
    const res = await erin.join(roomId, 'Erin');
    assert(res.chat.some((m) => m.text === 'hello everyone'), 'history missing earlier message');
  });

  await test('Chat from someone not in a room is rejected', async () => {
    const stranger = makeClient(base, 'stranger-session-1');
    clients.push(stranger);
    await sleep(200);
    const m = stranger.mark();
    stranger.emit('chat_message', { text: 'hi' });
    const err = await stranger.waitFor('error', () => true, m);
    assert(/not in a room/i.test(err.message), `got "${err.message}"`);
  });

  clients.forEach((c) => c.socket.close());
  stop();
  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
