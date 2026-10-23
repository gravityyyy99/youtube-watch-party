// Shared helpers for the automated tests: start the compiled server on a free port, create fake
// Socket.IO clients that record every event, and a tiny PASS/FAIL runner.
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';

// ES modules have no __dirname, so we build it from this file's URL.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Ask the OS for a free port so tests never clash with another running server.
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Starts server/src/index.js with a short reconnect grace period. Returns { base, stop }.
async function startServer() {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const server = spawn(process.execPath, [path.join(__dirname, '../src/index.js')], {
    env: { ...process.env, PORT: String(port), RECONNECT_GRACE_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/healthz`);
      break;
    } catch {
      await sleep(100);
    }
  }
  return { base, stop: () => server.kill() };
}

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
    // emit with an acknowledgement callback
    emitAck: (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve)),
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
    // Asserts that NO matching event arrives within `ms` after `from`.
    expectNone: async (event, from = 0, ms = 250) => {
      await sleep(ms);
      const hit = log.slice(from).find((e) => e.event === event);
      if (hit) throw new Error(`unexpected "${event}": ${JSON.stringify(hit.payload)}`);
    },
  };
}

// Collects PASS/FAIL results. Any thrown error (including a failed assert) is a FAIL with its message.
function createRunner() {
  const results = [];
  return {
    test: async (name, fn) => {
      try {
        await fn();
        results.push({ name, ok: true });
        console.log(`PASS  ${name}`);
      } catch (err) {
        results.push({ name, ok: false });
        console.log(`FAIL  ${name}\n        -> ${err.message}`);
      }
    },
    finish: () => {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
      process.exit(failed ? 1 : 0);
    },
  };
}

export { sleep, assert, startServer, makeClient, createRunner };
