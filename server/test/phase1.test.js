// Automated end-to-end test of the server (Phase 1). Run with: npm test   (from /server)
// It starts the compiled server on a free port, connects fake Socket.IO clients and prints PASS/FAIL per case.
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';

// ES modules have no __dirname, so we build it from this file's URL.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];

// ---------- helpers ----------

// Ask the OS for a free port so the test never clashes with another running server.
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake client that records every event it receives, so tests can wait for one that arrives later.
function makeClient(base, sessionId) {
  const socket = io(base, { transports: ['websocket'], forceNew: true });
  const log = [];
  socket.onAny((event, payload) => log.push({ event, payload }));
  return {
    socket,
    log,
    // Remember "now" in the log, so waitFor only looks at events that arrive after an action.
    mark: () => log.length,
    // join_room with roomId omitted creates a new room.
    join: (roomId, username, videoId) =>
      new Promise((resolve) => socket.emit('join_room', { roomId, username, sessionId, videoId }, resolve)),
    emit: (event, payload) => socket.emit(event, payload),
    // Resolves with the payload of the first matching event after `from`, or rejects after 2s.
    waitFor: async (event, predicate = () => true, from = 0) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const hit = log.slice(from).find((e) => e.event === event && predicate(e.payload));
        if (hit) return hit.payload;
        await sleep(20);
      }
      throw new Error(`timed out waiting for "${event}"`);
    },
  };
}

// Runs one case; any thrown error (including a failed assertion) is a FAIL with its message.
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n        -> ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- the tests ----------

async function main() {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const server = spawn(process.execPath, [path.join(__dirname, '../src/index.js')], {
    env: { ...process.env, PORT: String(port), RECONNECT_GRACE_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  // Wait until the server answers.
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/healthz`);
      break;
    } catch {
      await sleep(100);
    }
  }

  const A = makeClient(base, 'session-aaaaaaaa');
  const B = makeClient(base, 'session-bbbbbbbb');
  const C = makeClient(base, 'session-cccccccc');
  let roomId;
  const clients = [A, B, C];

  console.log(`Testing server at ${base}\n`);

  await test('1. A joins with no roomId -> gets 6-char roomId and is host', async () => {
    const res = await A.join(undefined, 'Alice');
    assert(res.ok, `join failed: ${res.message}`);
    assert(/^[A-Z0-9]{6}$/.test(res.roomId), `bad roomId "${res.roomId}"`);
    assert(res.you.role === 'host', `role was ${res.you.role}`);
    roomId = res.roomId;
  });

  await test('2. B joins with that roomId; both receive user_joined', async () => {
    const markA = A.mark();
    const markB = B.mark();
    const res = await B.join(roomId, 'Bob');
    assert(res.ok && res.you.role === 'participant', 'B should join as participant');
    const forA = await A.waitFor('user_joined', (p) => p.username === 'Bob', markA);
    const forB = await B.waitFor('user_joined', (p) => p.username === 'Bob', markB);
    assert(forA.participants.length === 2 && forB.participants.length === 2, 'participants list should have 2');
  });

  await test('3. B (participant) sends play -> permission error', async () => {
    const mark = B.mark();
    B.emit('play');
    const err = await B.waitFor('error', () => true, mark);
    assert(/permission/i.test(err.message), `unexpected message: ${err.message}`);
  });

  await test('New room starts with NO video; play is rejected until one is chosen', async () => {
    const first = A.log.find((e) => e.event === 'sync_state').payload;
    assert(first.videoId === null, 'a brand-new room must not have a default video, got ' + first.videoId);
    const mark = A.mark();
    A.emit('play');
    const err = await A.waitFor('error', () => true, mark);
    assert(/no video/i.test(err.message), 'unexpected message: ' + err.message);
  });

  await test('Host pastes any YouTube video -> everyone gets it (then pause, ready for case 4)', async () => {
    const markB = B.mark();
    A.emit('change_video', { videoId: 'dQw4w9WgXcQ' });
    const state = await B.waitFor('sync_state', (p) => p.videoId === 'dQw4w9WgXcQ', markB);
    assert(state.playState === 'playing', 'changed video should autoplay');
    const m = B.mark();
    A.emit('pause');
    await B.waitFor('sync_state', (p) => p.playState === 'paused', m);
  });

  await test('Creating a room WITH a first video starts it paused; a bad link is rejected', async () => {
    const maker = makeClient(base, 'session-ffffffff');
    clients.push(maker);
    const bad = await maker.join(undefined, 'Maker', 'bad link');
    assert(bad.ok === false, 'invalid first video must be rejected');
    const res = await maker.join(undefined, 'Maker', 'dQw4w9WgXcQ');
    assert(res.ok && res.you.role === 'host', 'create with video failed');
    const state = await maker.waitFor('sync_state', (p) => p.videoId === 'dQw4w9WgXcQ');
    assert(state.playState === 'paused' && state.currentTime === 0, 'should start paused at 0');
  });

  await test('4. A sends play -> both receive sync_state "playing"', async () => {
    const markA = A.mark();
    const markB = B.mark();
    A.emit('play');
    await A.waitFor('sync_state', (p) => p.playState === 'playing', markA);
    await B.waitFor('sync_state', (p) => p.playState === 'playing', markB);
  });

  await test('5. B sends assign_role -> error (host only)', async () => {
    const mark = B.mark();
    B.emit('assign_role', { userId: 'session-bbbbbbbb', role: 'moderator' });
    const err = await B.waitFor('error', () => true, mark);
    assert(/permission/i.test(err.message), `unexpected message: ${err.message}`);
  });

  await test('6. A assigns B moderator -> both receive role_assigned', async () => {
    const markA = A.mark();
    const markB = B.mark();
    A.emit('assign_role', { userId: 'session-bbbbbbbb', role: 'moderator' });
    const forA = await A.waitFor('role_assigned', (p) => p.role === 'moderator', markA);
    await B.waitFor('role_assigned', (p) => p.userId === 'session-bbbbbbbb', markB);
    assert(forA.username === 'Bob', 'role_assigned should name Bob');
  });

  await test('7. B (now moderator) can pause and play', async () => {
    let markA = A.mark();
    B.emit('pause');
    await A.waitFor('sync_state', (p) => p.playState === 'paused', markA);
    markA = A.mark();
    B.emit('play');
    await A.waitFor('sync_state', (p) => p.playState === 'playing', markA);
  });

  await test('Extra: invalid room code is rejected', async () => {
    const bad = makeClient(base, 'session-dddddddd');
    clients.push(bad);
    assert((await bad.join('!!', 'Dave')).ok === false, 'malformed code should fail');
    assert((await bad.join('ZZZZZZ', 'Dave')).ok === false, 'unknown room should fail');
    assert((await bad.join('', 'Dave')).ok === false, 'empty code must not silently create a room');
  });

  await test('Extra: duplicate username (case-insensitive) is rejected', async () => {
    const dup = makeClient(base, 'session-eeeeeeee');
    clients.push(dup);
    const res = await dup.join(roomId, 'ALICE');
    assert(res.ok === false && /taken/i.test(res.message), `got ${JSON.stringify(res)}`);
  });

  await test('Extra: late joiner gets the correct live current time', async () => {
    A.emit('seek', { time: 100 });
    await sleep(1500); // video is playing, so the live position should advance past 100
    const mark = C.mark();
    const res = await C.join(roomId, 'Carol');
    assert(res.ok, `join failed: ${res.message}`);
    const state = await C.waitFor('sync_state', () => true, mark);
    assert(state.playState === 'playing', `playState was ${state.playState}`);
    assert(state.currentTime >= 101 && state.currentTime < 105, `currentTime was ${state.currentTime}`);
  });

  await test('8. A disconnects -> B (moderator) becomes host and receives host_transferred', async () => {
    const mark = B.mark();
    A.socket.close();
    const evt = await B.waitFor('host_transferred', () => true, mark);
    assert(evt.newHostId === 'session-bbbbbbbb', `new host was ${evt.newHostId}`);
    assert(evt.reason === 'host_left', `reason was ${evt.reason}`);
    const me = evt.participants.find((p) => p.id === 'session-bbbbbbbb');
    assert(me.role === 'host', 'participants list should show B as host');
  });

  clients.forEach((c) => c.socket.close());
  server.kill();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
