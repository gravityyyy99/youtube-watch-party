// Automated test of emoji reactions. Run with: npm test   (from /server)
import { assert, createRunner, makeClient, sleep, startServer } from './helpers.js';

const { test, finish } = createRunner();

async function main() {
  const { base, stop } = await startServer();
  console.log(`Testing server at ${base}\n`);

  const host = makeClient(base, 'host-session-1');
  const mod = makeClient(base, 'mod-session-001');
  const viewer = makeClient(base, 'viewer-session-1');
  const clients = [host, mod, viewer];

  const created = await host.join(undefined, 'Host');
  const roomId = created.roomId;
  await mod.join(roomId, 'Mod');
  await viewer.join(roomId, 'Viewer');
  host.emit('assign_role', { userId: 'mod-session-001', role: 'moderator' });
  await mod.waitFor('role_assigned', (p) => p.role === 'moderator');

  await test('Host, Moderator and Viewer can each send a reaction; everyone (including the sender) receives it', async () => {
    for (const [sender, id, name] of [
      [host, 'host-session-1', 'Host'],
      [mod, 'mod-session-001', 'Mod'],
      [viewer, 'viewer-session-1', 'Viewer'],
    ]) {
      const marks = clients.map((c) => c.mark());
      sender.emit('send_reaction', { emoji: '🔥' });
      for (const [i, c] of clients.entries()) {
        const r = await c.waitFor('reaction', (p) => p.userId === id, marks[i]);
        assert(r.emoji === '🔥' && r.username === name && r.id, `wrong payload for ${name}: ${JSON.stringify(r)}`);
      }
      await sleep(300); // stay clear of the per-user rate limit between senders
    }
  });

  await test('Every emoji in the allowed list works', async () => {
    for (const emoji of ['👍', '❤️', '😂', '😮', '👏', '🔥', '🎉', '😢']) {
      const m = host.mark();
      viewer.emit('send_reaction', { emoji });
      const r = await host.waitFor('reaction', (p) => p.emoji === emoji, m);
      assert(r.userId === 'viewer-session-1', 'wrong sender');
      await sleep(280);
    }
  });

  await test('Anything that is not an allowed emoji is rejected with an error and not broadcast', async () => {
    for (const emoji of ['<script>alert(1)</script>', 'hello', '', '💩', 123, null, undefined]) {
      const [mv, mh] = [viewer.mark(), host.mark()];
      viewer.emit('send_reaction', { emoji });
      await viewer.waitFor('error', () => true, mv);
      await host.expectNone('reaction', mh, 80);
    }
  });

  await test('Reactions sent faster than every 250 ms are dropped (rate limit)', async () => {
    await sleep(300);
    const m = host.mark();
    for (let i = 0; i < 20; i++) viewer.emit('send_reaction', { emoji: '👍' });
    await sleep(400);
    const got = host.log.slice(m).filter((e) => e.event === 'reaction').length;
    assert(got >= 1 && got <= 3, `expected 1-3 of 20 rapid reactions to get through, got ${got}`);
  });

  await test('A different user is not affected by someone else\'s rate limit', async () => {
    await sleep(300);
    const m = host.mark();
    viewer.emit('send_reaction', { emoji: '👍' });
    mod.emit('send_reaction', { emoji: '👏' });
    await host.waitFor('reaction', (p) => p.userId === 'viewer-session-1', m);
    await host.waitFor('reaction', (p) => p.userId === 'mod-session-001', m);
  });

  await test('Someone who is not in a room cannot send reactions', async () => {
    const stranger = makeClient(base, 'stranger-session-1');
    clients.push(stranger);
    await sleep(200);
    const m = stranger.mark();
    stranger.emit('send_reaction', { emoji: '👍' });
    const err = await stranger.waitFor('error', () => true, m);
    assert(/not in a room/i.test(err.message), `got "${err.message}"`);
  });

  await test('A removed user can no longer send reactions', async () => {
    host.emit('remove_participant', { userId: 'viewer-session-1' });
    await viewer.waitFor('participant_removed', (p) => p.userId === 'viewer-session-1');
    const m = viewer.mark();
    viewer.emit('send_reaction', { emoji: '👍' });
    const err = await viewer.waitFor('error', () => true, m);
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
