// The position the video SHOULD be at right now, according to the last server update.
// While playing, time keeps advancing since we received the update; while paused it stands still.
export function currentPosition(sync) {
  const elapsed = sync.playState === 'playing' ? (Date.now() - sync.receivedAt) / 1000 : 0;
  return sync.currentTime + elapsed;
}

// Turns "90", "1:30" or "1:02:03" into seconds. Returns null if it isn't a valid time.
export function parseTime(input) {
  const parts = input.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
