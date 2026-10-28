import { io } from 'socket.io-client';
import { SERVER_URL } from './config';

// One shared Socket.IO connection for the whole app. No URL means "same origin as the page"
// (Vite proxies it in dev, Express serves it in production); with VITE_BACKEND_URL set (Vercel) it
// connects to that backend instead. We connect manually, when needed.
export const socket = SERVER_URL ? io(SERVER_URL, { autoConnect: false }) : io({ autoConnect: false });

// A random id that lives as long as this browser tab. Sent with join_room so the server can tell
// "same person refreshed the page" from "a new person", and keep their seat and role.
export function getSessionId() {
  try {
    let id = sessionStorage.getItem('wp_session');
    if (!id) {
      id =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(16).slice(2) + Date.now().toString(16);
      sessionStorage.setItem('wp_session', id);
    }
    return id;
  } catch {
    return 'anon-' + Math.random().toString(16).slice(2);
  }
}

export function getStoredUsername() {
  try {
    return sessionStorage.getItem('wp_username') ?? '';
  } catch {
    return '';
  }
}

export function storeUsername(name) {
  try {
    sessionStorage.setItem('wp_username', name);
  } catch {
    /* storage unavailable: user will just be asked again */
  }
}

// My optional profile picture (a small JPEG data URL), remembered for this tab so it survives refresh.
export function getStoredAvatar() {
  try {
    return sessionStorage.getItem('wp_avatar');
  } catch {
    return null;
  }
}

export function storeAvatar(dataUrl) {
  try {
    if (dataUrl) sessionStorage.setItem('wp_avatar', dataUrl);
    else sessionStorage.removeItem('wp_avatar');
  } catch {
    /* storage unavailable: the picture just won't survive a refresh */
  }
}

// Sends join_room right now (the socket must already be connected). roomId undefined = create a room,
// optionally starting with that video (an 11-character YouTube id).
export function emitJoin(roomId, username, videoId) {
  return new Promise((resolve) => {
    socket.emit(
      'join_room',
      { roomId, username, sessionId: getSessionId(), videoId, avatar: getStoredAvatar() },
      resolve,
    );
  });
}

// Like emitJoin, but connects first if needed. Used by the Home page.
export async function connectAndJoin(roomId, username, videoId) {
  if (!socket.connected) {
    await new Promise((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', () => reject(new Error('Cannot reach the server')));
      socket.connect();
    });
  }
  return emitJoin(roomId, username, videoId);
}
