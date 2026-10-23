import { RoomError } from './errors.js';

// Pure input-validation helpers. They never touch room state; they only
// clean/check what a client sent and throw a RoomError if it is unacceptable.
// Every value from a socket is untrusted, so each event handler runs these first.

export const MAX_USERNAME_LENGTH = 20;
export const MAX_CHAT_LENGTH = 500;

// Trims and checks a username (non-empty, short).
export function validateUsername(value) {
  if (typeof value !== 'string') throw new RoomError('Username is required');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0) throw new RoomError('Username cannot be empty');
  if (name.length > MAX_USERNAME_LENGTH)
    throw new RoomError(`Username must be at most ${MAX_USERNAME_LENGTH} characters`);
  return name;
}

// Room codes are upper-case letters/digits; we upper-case so "abc123" and "ABC123" both work.
export function validateRoomCode(value) {
  if (typeof value !== 'string') throw new RoomError('Room code is required');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new RoomError('Invalid room code');
  return code;
}

// A YouTube video id is exactly 11 chars of [A-Za-z0-9_-].
export function validateVideoId(value) {
  if (typeof value !== 'string' || !/^[\w-]{11}$/.test(value)) throw new RoomError('Invalid YouTube video');
  return value;
}

// Seek position in seconds: finite and not negative. Capped at 24h to reject nonsense.
export function validateTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 86400) {
    throw new RoomError('Invalid seek time');
  }
  return value;
}

// Only these two roles can be handed out with assign_role. "host" only moves via transfer_host.
export function validateAssignableRole(value) {
  if (value !== 'moderator' && value !== 'participant') throw new RoomError('Invalid role');
  return value;
}

export function validateUserId(value) {
  if (typeof value !== 'string' || value.length === 0) throw new RoomError('Invalid user');
  return value;
}

export function validateChatText(value) {
  if (typeof value !== 'string') throw new RoomError('Message cannot be empty');
  const text = value.trim();
  if (text.length === 0) throw new RoomError('Message cannot be empty');
  if (text.length > MAX_CHAT_LENGTH) throw new RoomError(`Message must be at most ${MAX_CHAT_LENGTH} characters`);
  return text;
}

// Validates a request_action payload and returns a cleaned copy.
export function validateRequest(type, payload) {
  const data = payload ?? {};
  switch (type) {
    case 'play':
    case 'pause':
      return { type, payload: {} };
    case 'seek':
      return { type, payload: { time: validateTime(data.time) } };
    case 'change_video':
      return { type, payload: { videoId: validateVideoId(data.videoId) } };
    default:
      throw new RoomError('Unknown request type');
  }
}

// Profile picture: a base64 JPEG data URL (the browser shrinks it to ~128px before sending).
// We decode it and check the real JPEG signature bytes, never trusting the declared type, and cap
// the size. Returns the raw bytes, or null when the user is clearing their picture.
export const MAX_AVATAR_BYTES = 60 * 1024;
export function validateAvatar(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new RoomError('Invalid profile picture');
  const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new RoomError('Profile picture must be a JPEG image');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) throw new RoomError('Profile picture is too large');
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isJpeg) throw new RoomError('Profile picture must be a JPEG image');
  return bytes;
}

// Emoji reactions: only these (so a client can't broadcast arbitrary text through the reaction channel).
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🔥', '🎉', '😢'];
export function validateReaction(value) {
  if (typeof value !== 'string' || !ALLOWED_REACTIONS.includes(value)) throw new RoomError('Unknown reaction');
  return value;
}
