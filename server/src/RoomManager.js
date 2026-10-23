import { randomInt } from 'crypto';
import { Room } from './Room.js';

// No 0/O/1/I so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
// A room nobody ever joined (creator closed the tab) is deleted after this long.
const UNUSED_ROOM_TTL_MS = 10 * 60 * 1000;

// Owns every Room in memory: create, look up, delete. Everything is lost on server restart (by design: no DB).
export class RoomManager {
  rooms = new Map();

  // Creates a room with a fresh unique short code.
  createRoom() {
    let id = this.randomCode();
    while (this.rooms.has(id)) id = this.randomCode();
    const room = new Room(id);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  deleteRoom(id) {
    this.rooms.delete(id);
  }

  get size() {
    return this.rooms.size;
  }

  // Deletes rooms that are empty. Rooms emptied by users leaving are deleted immediately by
  // MessageHandler; this sweep only catches rooms created but never joined.
  cleanupEmptyRooms(now = Date.now()) {
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.isEmpty && now - room.createdAt > UNUSED_ROOM_TTL_MS) {
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // crypto.randomInt (not Math.random) so codes aren't guessable from earlier ones.
  randomCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return code;
  }
}
