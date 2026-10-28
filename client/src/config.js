// Where the backend lives. Empty (the default) means "same origin as the page": that is how Render and
// local dev work. On Vercel the frontend and backend are separate, so set VITE_BACKEND_URL at build
// time to the backend's address, for example https://watch-party.up.railway.app (no trailing slash).
export const SERVER_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');

// Turns a server-relative path like /api/... into a full URL when the backend is on another origin.
export const serverUrl = (path) => (path && path.startsWith('/') ? SERVER_URL + path : path);
