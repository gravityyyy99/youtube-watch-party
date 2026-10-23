// One person in a room. `id` is a stable per-browser-tab session id (NOT the socket id),
// so a page refresh (new socket) can be recognised as the same person and keep their role.
export class Participant {
  joinedAt = Date.now();
  // Optional profile picture: a small JPEG kept in memory. `avatarVersion` changes on every update
  // so browsers re-download it instead of showing a cached old picture.
  avatar = null;
  avatarVersion = 0;
  lastReactionAt = 0; // epoch ms, used to rate-limit reactions

  constructor(
    id,
    username,
    role,
    // null while the user is disconnected but still inside the reconnect grace period
    socketId,
  ) {
    this.id = id;
    this.username = username;
    this.role = role;
    this.socketId = socketId;
  }

  setAvatar(image) {
    this.avatar = image;
    this.avatarVersion += 1;
  }

  // Safe public view sent to clients (hides socketId). The picture itself is not embedded in every
  // event; clients load it from `avatar` (a URL served by GET /api/rooms/:id/avatar/:userId).
  toDTO(roomId) {
    return {
      id: this.id,
      username: this.username,
      role: this.role,
      avatar: this.avatar ? `/api/rooms/${roomId}/avatar/${this.id}?v=${this.avatarVersion}` : null,
    };
  }
}
