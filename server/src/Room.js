import { randomUUID } from 'crypto';
import { RoomError } from './errors.js';
import { Participant } from './Participant.js';

const MAX_CHAT_HISTORY = 50;
const MAX_PENDING_PER_USER = 5;

// All state of ONE watch party: who is in it, what video is playing, pending requests, chat.
// It contains no socket code. It only changes state and returns results, so it is easy to reason about.
// Who is ALLOWED to call these methods is decided earlier, in MessageHandler + permissions.ts.
export class Room {
  participants = new Map(); // Map keeps insertion order = join order
  pendingRequests = new Map();
  chatLog = [];
  createdAt = Date.now();
  bannedIds = new Set();

  // A new room has NO video: the Host picks one (optionally when creating the room, or later by
  // pasting a YouTube link). Any YouTube video is allowed.
  videoState = {
    videoId: null,
    playState: 'paused',
    currentTime: 0,
    updatedAt: Date.now(),
  };

  constructor(id) {
    this.id = id;
  }

  get isEmpty() {
    return this.participants.size === 0;
  }

  // ---------- participants ----------

  // Adds a new person. The very first person in a fresh room is the creator, so they become Host;
  // everyone after is a Participant. Rejects banned users and duplicate usernames (case-insensitive).
  addParticipant(id, username, socketId) {
    if (this.bannedIds.has(id)) throw new RoomError('You were removed from this room');
    const taken = [...this.participants.values()].some((p) => p.username.toLowerCase() === username.toLowerCase());
    if (taken) throw new RoomError('That username is already taken in this room');
    const role = this.participants.size === 0 ? 'host' : 'participant';
    const participant = new Participant(id, username, role, socketId);
    this.participants.set(id, participant);
    return participant;
  }

  // Removes a person, bans them if `ban` (used when the Host kicks someone), deletes their pending
  // requests, and if they were the Host promotes a successor so the room is never host-less.
  // Returns { participant, newHost, droppedRequests }: who left, who (if anyone) was auto-promoted, and
  // which of their requests vanished with them.
  removeParticipant(id, ban = false) {
    const participant = this.participants.get(id);
    if (!participant) throw new RoomError('User not found in this room');
    this.participants.delete(id);
    if (ban) this.bannedIds.add(id);

    const droppedRequests = [...this.pendingRequests.values()].filter((r) => r.userId === id);
    droppedRequests.forEach((r) => this.pendingRequests.delete(r.id));

    let newHost = null;
    if (participant.role === 'host') newHost = this.promoteSuccessor();
    return { participant, newHost, droppedRequests };
  }

  // Picks the next Host: earliest-joined Moderator if any, otherwise earliest-joined Participant.
  promoteSuccessor() {
    const all = [...this.participants.values()]; // already in join order
    const next = all.find((p) => p.role === 'moderator') ?? all[0];
    if (!next) return null;
    next.role = 'host';
    return next;
  }

  get host() {
    return [...this.participants.values()].find((p) => p.role === 'host');
  }

  // Changes a Participant <-> Moderator. The Host's own role can't be changed this way.
  assignRole(userId, role) {
    const target = this.requireParticipant(userId);
    if (target.role === 'host') throw new RoomError("You can't change the Host's role");
    target.role = role;
    return target;
  }

  // Gives the Host role to someone else; the old Host becomes a plain Participant.
  transferHost(fromId, toId) {
    const oldHost = this.requireParticipant(fromId);
    const newHost = this.requireParticipant(toId);
    if (oldHost.id === newHost.id) throw new RoomError('You are already the Host');
    oldHost.role = 'participant';
    newHost.role = 'host';
    return { oldHost, newHost };
  }

  getParticipant(id) {
    return this.participants.get(id);
  }

  requireParticipant(id) {
    const p = this.participants.get(id);
    if (!p) throw new RoomError('User not found in this room');
    return p;
  }

  listParticipants() {
    return [...this.participants.values()].map((p) => p.toDTO(this.id));
  }

  // ---------- playback state ----------

  // Live position: if the video is playing, time keeps moving since the last update,
  // so we add the wall-clock time elapsed. A late joiner therefore lands at the right spot.
  getCurrentState() {
    const { videoId, playState, currentTime, updatedAt } = this.videoState;
    const elapsed = playState === 'playing' ? (Date.now() - updatedAt) / 1000 : 0;
    return { playState, currentTime: currentTime + elapsed, videoId };
  }

  // Freeze the live position into videoState so the next change starts from the right spot.
  commit(playState, currentTime, videoId = this.videoState.videoId) {
    this.videoState = { videoId, playState, currentTime, updatedAt: Date.now() };
  }

  // Play/pause/seek make no sense before a video has been chosen.
  requireVideo() {
    if (!this.videoState.videoId) throw new RoomError('No video yet. Paste a YouTube link first.');
  }

  play() {
    this.requireVideo();
    this.commit('playing', this.getCurrentState().currentTime);
  }

  pause() {
    this.requireVideo();
    this.commit('paused', this.getCurrentState().currentTime);
  }

  seek(time) {
    this.requireVideo();
    this.commit(this.videoState.playState, time);
  }

  // New video starts from 0. It plays immediately, except when chosen while creating the room
  // (autoplay=false), so the Host can wait for friends before pressing play.
  changeVideo(videoId, autoplay = true) {
    this.commit(autoplay ? 'playing' : 'paused', 0, videoId);
  }

  // ---------- request / approval ----------

  // Stores a Participant's request until a Host/Moderator approves or rejects it.
  createRequest(participant, type, payload) {
    if (type !== 'change_video') this.requireVideo();
    const mine = [...this.pendingRequests.values()].filter((r) => r.userId === participant.id).length;
    if (mine >= MAX_PENDING_PER_USER) throw new RoomError('You have too many pending requests');
    const request = {
      id: randomUUID(),
      userId: participant.id,
      username: participant.username,
      type,
      payload,
      createdAt: Date.now(),
    };
    this.pendingRequests.set(request.id, request);
    return request;
  }

  // Removes the request from the queue; if approved, applies it to the real video state.
  // Whoever resolves it first wins; a second resolver gets "already handled".
  resolveRequest(requestId, approve) {
    const request = this.pendingRequests.get(requestId);
    if (!request) throw new RoomError('That request was already handled');
    this.pendingRequests.delete(requestId);
    if (approve) this.applyRequest(request);
    return request;
  }

  applyRequest(request) {
    switch (request.type) {
      case 'play':
        return this.play();
      case 'pause':
        return this.pause();
      case 'seek':
        return this.seek(request.payload.time ?? 0);
      case 'change_video':
        return this.changeVideo(request.payload.videoId); // validated when the request was made
    }
  }

  listRequests() {
    return [...this.pendingRequests.values()];
  }

  // ---------- chat ----------

  addChat(participant, text) {
    const message = {
      id: randomUUID(),
      userId: participant.id,
      username: participant.username,
      text,
      timestamp: Date.now(),
    };
    this.chatLog.push(message);
    if (this.chatLog.length > MAX_CHAT_HISTORY) this.chatLog.shift();
    return message;
  }
}
