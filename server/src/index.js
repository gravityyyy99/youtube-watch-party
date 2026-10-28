import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { MessageHandler } from './MessageHandler.js';
import { RoomManager } from './RoomManager.js';
import { validateRoomCode } from './validators.js';

// Entry point: one Node process serves the REST bits, the built React app, and the WebSocket server.
const PORT = Number(process.env.PORT) || 4000;
// ES modules have no __dirname, so we build it from this file's URL. This file is server/src/index.js,
// so ../../client/dist is /client/dist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = process.env.CLIENT_DIST || path.resolve(__dirname, '../../client/dist');

const app = express();
app.use(express.json());
const httpServer = http.createServer(app);

// Same origin on Render (Express serves the frontend) and in dev (Vite proxies), so no CORS needed.
// When the frontend is hosted separately (Vercel), set CLIENT_ORIGIN to its address(es), comma-separated,
// e.g. https://my-app.vercel.app. Unset = CORS stays off.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const io = new Server(httpServer, CLIENT_ORIGINS.length ? { cors: { origin: CLIENT_ORIGINS } } : {});
if (CLIENT_ORIGINS.length) {
  app.use('/api', (req, res, next) => {
    if (CLIENT_ORIGINS.includes(req.headers.origin)) res.set('Access-Control-Allow-Origin', req.headers.origin);
    res.set('Vary', 'Origin');
    next();
  });
}
const rooms = new RoomManager();
new MessageHandler(io, rooms).register();

// Render hits this to know the service is alive.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// Lets the frontend say "Room not found" before asking for a username.
app.get('/api/rooms/:id', (req, res) => {
  try {
    const id = validateRoomCode(req.params.id);
    res.json({ exists: Boolean(rooms.getRoom(id)) });
  } catch {
    res.json({ exists: false });
  }
});

// Profile pictures live in memory on the Participant. This serves one as an image. The ?v= number in
// the URL changes when the picture changes, so it can be cached for a long time safely.
app.get('/api/rooms/:id/avatar/:userId', (req, res) => {
  let image;
  try {
    image = rooms.getRoom(validateRoomCode(req.params.id))?.getParticipant(req.params.userId)?.avatar;
  } catch {
    image = null;
  }
  if (!image) {
    res.status(404).end();
    return;
  }
  res.set({
    'Content-Type': 'image/jpeg',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=86400',
  });
  res.send(image);
});

// Serve the built React app; unknown non-API paths (like /room/ABC123) fall back to index.html
// so React Router can handle them on refresh.
// The existence check happens per request, so a missing client/dist (dev, or tests) answers a
// clear 404 message instead of an ENOENT crash, and a later build is picked up without a restart.
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');
if (!fs.existsSync(CLIENT_INDEX)) {
  console.warn(`Client build not found at ${CLIENT_DIST} (fine in dev; run "npm run build" for production).`);
}
app.use(express.static(CLIENT_DIST));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  if (!fs.existsSync(CLIENT_INDEX)) {
    res.status(404).send('Client not built. Run "npm run build", or use the Vite dev server in development.');
    return;
  }
  res.sendFile(CLIENT_INDEX);
});

setInterval(() => rooms.cleanupEmptyRooms(), 60_000).unref();

// Last line of defence: if some unexpected error ever escapes, log it instead of letting the process
// die. A crash would restart the server and silently close every open room.
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

httpServer.listen(PORT, () => console.log(`Watch Party server listening on port ${PORT}`));
