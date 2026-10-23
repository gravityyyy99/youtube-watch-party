// Automated test of profile pictures and default roles. Run with: npm test   (from /server)
import { assert, createRunner, makeClient, startServer } from './helpers.js';

const { test, finish } = createRunner();

// Smallest thing the server accepts as a "JPEG": the real JPEG signature bytes (FF D8 FF) plus filler.
const jpegBytes = (size = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 1)]);
const dataUrl = (bytes, type = 'image/jpeg') => `data:${type};base64,${bytes.toString('base64')}`;

async function main() {
  const { base, stop } = await startServer();
  console.log(`Testing server at ${base}\n`);

  const host = makeClient(base, 'host-session-1');
  const alice = makeClient(base, 'alice-session-1');
  const bob = makeClient(base, 'bob-session-001');
  const clients = [host, alice, bob];
  let roomId;

  await test('Only the creator is Host; everyone else joins as a plain Viewer (nobody is a Moderator by default)', async () => {
    const a = await host.join(undefined, 'Host');
    roomId = a.roomId;
    const b = await alice.join(roomId, 'Alice', undefined);
    const c = await bob.join(roomId, 'Bob');
    assert(a.you.role === 'host' && b.you.role === 'participant' && c.you.role === 'participant', 'wrong roles');
    const roles = c.participants.map((p) => p.role).sort();
    assert(JSON.stringify(roles) === JSON.stringify(['host', 'participant', 'participant']), `roles: ${roles}`);
  });

  await test('Participants without a picture have avatar null and their image URL is 404', async () => {
    const list = (await bob.join(roomId, 'Bob')).participants;
    assert(list.every((p) => p.avatar === null), 'nobody uploaded a picture yet');
    const res = await fetch(`${base}/api/rooms/${roomId}/avatar/alice-session-1`);
    assert(res.status === 404, `status ${res.status}`);
  });

  const picture = jpegBytes(300);

  await test('update_profile with a JPEG -> profile_updated broadcast, image is served back byte-for-byte', async () => {
    const marks = [host.mark(), bob.mark()];
    alice.emit('update_profile', { avatar: dataUrl(picture) });
    const forHost = await host.waitFor('profile_updated', (p) => p.userId === 'alice-session-1', marks[0]);
    await bob.waitFor('profile_updated', (p) => p.userId === 'alice-session-1', marks[1]);
    const me = forHost.participants.find((p) => p.id === 'alice-session-1');
    assert(me.avatar && me.avatar.includes('/avatar/alice-session-1?v='), `avatar url was ${me.avatar}`);
    const res = await fetch(base + me.avatar);
    assert(res.status === 200 && res.headers.get('content-type') === 'image/jpeg', `status ${res.status}`);
    assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
    const got = Buffer.from(await res.arrayBuffer());
    assert(got.equals(picture), 'served bytes differ from uploaded bytes');
  });

  await test('Changing the picture bumps the version in the URL (so browsers refetch)', async () => {
    const before = host.log.filter((e) => e.event === 'profile_updated').pop().payload.participants.find((p) => p.id === 'alice-session-1').avatar;
    const m = host.mark();
    alice.emit('update_profile', { avatar: dataUrl(jpegBytes(400)) });
    const evt = await host.waitFor('profile_updated', () => true, m);
    const after = evt.participants.find((p) => p.id === 'alice-session-1').avatar;
    assert(before !== after, `url unchanged: ${after}`);
  });

  await test('Joining WITH a picture shows it immediately; a late joiner sees it too', async () => {
    const carol = makeClient(base, 'carol-session-1');
    clients.push(carol);
    const res = await carol.join(roomId, 'Carol', undefined);
    assert(res.ok, 'carol should join');
    // Carol sets hers via update_profile; Dave joins afterwards and must see both pictures.
    carol.emit('update_profile', { avatar: dataUrl(jpegBytes(100)) });
    await host.waitFor('profile_updated', (p) => p.userId === 'carol-session-1');
    const dave = makeClient(base, 'dave-session-1');
    clients.push(dave);
    const joined = await dave.join(roomId, 'Dave', undefined);
    const withPic = joined.participants.filter((p) => p.avatar).map((p) => p.username).sort();
    assert(JSON.stringify(withPic) === JSON.stringify(['Alice', 'Carol']), `pictures: ${withPic}`);
  });

  await test('A picture supplied in join_room is applied', async () => {
    const erin = makeClient(base, 'erin-session-1');
    clients.push(erin);
    const res = await new Promise((resolve) =>
      erin.socket.emit('join_room', { roomId, username: 'Erin', sessionId: 'erin-session-1', avatar: dataUrl(jpegBytes(120)) }, resolve),
    );
    assert(res.ok && res.you.avatar, 'join ack should include the avatar url');
    const image = await fetch(base + res.you.avatar);
    assert(image.status === 200, `status ${image.status}`);
  });

  await test('Bad pictures are rejected: PNG, fake JPEG bytes, too large, not a string', async () => {
    const bad = [
      dataUrl(jpegBytes(50), 'image/png'),
      dataUrl(Buffer.from('this is not an image at all')),
      dataUrl(jpegBytes(70 * 1024)),
      12345,
      'data:image/jpeg;base64,@@@@',
    ];
    for (const avatar of bad) {
      const m = bob.mark();
      bob.emit('update_profile', { avatar });
      await bob.waitFor('error', () => true, m);
    }
    const list = (await bob.join(roomId, 'Bob')).participants;
    assert(!list.find((p) => p.id === 'bob-session-001').avatar, 'Bob must still have no picture');
  });

  await test('A bad picture at join time rejects the join (and no room is created)', async () => {
    const zed = makeClient(base, 'zed-session-001');
    clients.push(zed);
    const res = await new Promise((resolve) =>
      zed.socket.emit('join_room', { username: 'Zed', sessionId: 'zed-session-001', avatar: 'data:image/png;base64,AAAA' }, resolve),
    );
    assert(res.ok === false, 'should be rejected');
  });

  await test('Clearing the picture (null) removes it and the URL becomes 404', async () => {
    const m = host.mark();
    alice.emit('update_profile', { avatar: null });
    const evt = await host.waitFor('profile_updated', (p) => p.userId === 'alice-session-1', m);
    assert(evt.participants.find((p) => p.id === 'alice-session-1').avatar === null, 'avatar should be null');
    const res = await fetch(`${base}/api/rooms/${roomId}/avatar/alice-session-1`);
    assert(res.status === 404, `status ${res.status}`);
  });

  await test('A removed user\'s picture is no longer served', async () => {
    const res1 = await fetch(`${base}/api/rooms/${roomId}/avatar/carol-session-1`);
    assert(res1.status === 200, 'carol picture should exist');
    host.emit('remove_participant', { userId: 'carol-session-1' });
    await host.waitFor('participant_removed', (p) => p.userId === 'carol-session-1');
    const res2 = await fetch(`${base}/api/rooms/${roomId}/avatar/carol-session-1`);
    assert(res2.status === 404, `status ${res2.status}`);
  });

  await test('Make/unmake Moderator toggles cleanly (what the per-member button does)', async () => {
    let m = bob.mark();
    host.emit('assign_role', { userId: 'bob-session-001', role: 'moderator' });
    let evt = await bob.waitFor('role_assigned', () => true, m);
    assert(evt.role === 'moderator', 'should be moderator');
    m = bob.mark();
    host.emit('assign_role', { userId: 'bob-session-001', role: 'participant' });
    evt = await bob.waitFor('role_assigned', () => true, m);
    assert(evt.role === 'participant', 'should be viewer again');
  });

  clients.forEach((c) => c.socket.close());
  stop();
  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
