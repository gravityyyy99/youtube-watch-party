import { randomUUID } from 'crypto';

import { RoomError } from './errors.js';
import { ACTION_LABELS, can } from './permissions.js';

import {
  validateAssignableRole,
  validateAvatar,
  validateChatText,
  validateRequest,
  validateReaction,
  validateRoomCode,
  validateTime,
  validateUserId,
  validateUsername,
  validateVideoId,
} from './validators.js';

// After a socket drops, we wait this long before treating the user as gone.
// A page refresh reconnects within a second or two and silently keeps its seat and role.
// Configurable through the environment so automated tests don't have to wait 10 seconds.
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 30_000;

const REACTION_MIN_INTERVAL_MS = 250;


// Wires up every Socket.IO event. For each event it does the same three steps:
//   1. identify the sender (room + participant) from socket.data
//   2. check permission via permissions.ts (the security gate; happens BEFORE the handler runs)
//   3. validate the payload, call a Room method, then emit the result
// State lives in Room, "who may do what" in permissions.ts, input checks in validators.ts.
export class MessageHandler {
  // participantId+room -> pending "really gone" timer, cancelled if the user reconnects in time
  graceTimers = new Map();

  constructor(io, rooms) {
    this.io = io;
    this.rooms = rooms;
  }

  // Call once at startup: every new connection gets all event listeners attached.
  register() {
    this.io.on('connection', (socket) => {
      socket.on('join_room', (payload, ack) => this.safely(socket, ack, () => this.onJoinRoom(socket, payload, ack)));
      socket.on('leave_room', () => this.safely(socket, undefined, () => this.onLeaveRoom(socket)));

      // Playback controls: only Host and Moderator pass the permission gate.
      this.bind(socket, 'play', 'play', (ctx) => {
        ctx.room.play();
        this.broadcastState(ctx.room);
      });
      this.bind(socket, 'pause', 'pause', (ctx) => {
        ctx.room.pause();
        this.broadcastState(ctx.room);
      });
      this.bind(socket, 'seek', 'seek', (ctx, payload) => {
        ctx.room.seek(validateTime(payload?.time));
        this.broadcastState(ctx.room);
      });
      this.bind(socket, 'change_video', 'change_video', (ctx, payload) => {
        ctx.room.changeVideo(validateVideoId(payload?.videoId));
        this.broadcastState(ctx.room);
      });

      // Host-only management.
      this.bind(socket, 'assign_role', 'assign_role', (ctx, payload) => this.onAssignRole(ctx, payload));
      this.bind(socket, 'remove_participant', 'remove_participant', (ctx, payload) =>
        this.onRemoveParticipant(ctx, payload),
      );
      this.bind(socket, 'transfer_host', 'transfer_host', (ctx, payload) => this.onTransferHost(ctx, payload));

      // Request / approval flow.
      this.bind(socket, 'request_action', 'request_action', (ctx, payload, ack) =>
        this.onRequestAction(ctx, payload, ack),
      );
      this.bind(socket, 'resolve_request', 'resolve_request', (ctx, payload) => this.onResolveRequest(ctx, payload));

      // update_profile {avatar}: change or clear my profile picture (null clears). Everyone is told so
      // their lists refresh. Allowed for every role: it only affects my own entry.
      this.bind(socket, 'update_profile', 'update_profile', (ctx, payload) => {
        ctx.me.setAvatar(validateAvatar(payload?.avatar));
        this.io.to(ctx.room.id).emit('profile_updated', {
          userId: ctx.me.id,
          participants: ctx.room.listParticipants(),
        });
      });

      // send_reaction {emoji}: an emoji from a fixed list, shown floating over everyone's player.
      // Allowed for every role (it changes no state). Sending faster than every 250 ms is silently
      // dropped so nobody can flood the room.
      this.bind(socket, 'send_reaction', 'send_reaction', (ctx, payload) => {
        const emoji = validateReaction(payload?.emoji);
        const now = Date.now();
        if (now - ctx.me.lastReactionAt < REACTION_MIN_INTERVAL_MS) return;
        ctx.me.lastReactionAt = now;
        this.io.to(ctx.room.id).emit('reaction', {
          id: randomUUID(),
          userId: ctx.me.id,
          username: ctx.me.username,
          emoji,
        });
      });

      this.bind(socket, 'chat_message', 'chat_message', (ctx, payload) => {
        const message = ctx.room.addChat(ctx.me, validateChatText(payload?.text));
        this.io.to(ctx.room.id).emit('chat_message', message);
      });

      socket.on('disconnect', () => this.onDisconnect(socket));
    });
  }

  // ---------- plumbing ----------

  // Registers `event` with the standard pipeline: find sender -> permission check -> handler.
  // `action` is the key into permissions.ts. This is the single place permissions are enforced.
  bind(socket, event, action, handler) {
    socket.on(event, (payload, ack) => {
      this.safely(socket, ack, () => {
        const ctx = this.getContext(socket);
        if (!can(ctx.me.role, action)) {
          throw new RoomError(`You don't have permission to ${ACTION_LABELS[action]}`);
        }
        handler(ctx, payload, ack);
      });
    });
  }

  // Looks up the room and participant that this socket belongs to.
  // A socket that was removed/left has empty socket.data, so every event fails here.
  getContext(socket) {
    const { roomId, participantId } = socket.data;
    const room = roomId ? this.rooms.getRoom(roomId) : undefined;
    const me = room && participantId ? room.getParticipant(participantId) : undefined;
    // me.socketId check: if the same user opened a newer connection, this older socket is dead.
    if (!room || !me || me.socketId !== socket.id) throw new RoomError('You are not in a room');
    return { room, me };
  }

  // Runs a handler; RoomErrors become an `error` event (and a failed ack), bugs are logged.
  safely(socket, ack, fn) {
    try {
      fn();
    } catch (err) {
      const message = err instanceof RoomError ? err.message : 'Something went wrong';
      if (!(err instanceof RoomError)) console.error('Unexpected error in socket handler:', err);
      socket.emit('error', { message });
      if (typeof ack === 'function') ack({ ok: false, message });
    }
  }

  // Sends the authoritative state to everyone in the room, including whoever triggered it.
  broadcastState(room) {
    this.io.to(room.id).emit('sync_state', room.getCurrentState());
  }

  // Sends the pending-request list to one participant, if their role can resolve requests.
  // Used when someone becomes Host/Moderator and so needs to see requests made earlier.
  sendRequestList(room, person) {
    if (!person.socketId || !can(person.role, 'resolve_request')) return;
    this.io.to(person.socketId).emit('request_list', { requests: room.listRequests() });
  }

  // ---------- join / leave ----------

  // join_room {roomId?, username, sessionId?, videoId?}  (roomId omitted = create a new room,
  // optionally with a first video)
  // New person: add as Participant (or Host if first). Known sessionId: it's a reconnect (refresh),
  // so rebind to the existing seat instead of creating a duplicate. Replies via ack with the
  // joiner's identity, then sends sync_state so they start at the current video position.
  onJoinRoom(socket, payload, ack) {
    const username = validateUsername(payload?.username);
    const avatar = validateAvatar(payload?.avatar); // optional profile picture, validated before anything is created
    const sessionId =
      typeof payload?.sessionId === 'string' && /^[\w-]{8,64}$/.test(payload.sessionId)
        ? payload.sessionId
        : randomUUID();

    // No roomId at all means "create a new room" (the creator then becomes Host as first member).
    // A roomId that is present but wrong (even an empty string) is an error, never a silent create.
    const wantsNewRoom = payload?.roomId === undefined || payload?.roomId === null;
    // When creating, the Host may optionally pick the first video (validated BEFORE the room exists,
    // so a bad link never leaves an empty room behind). It starts paused. Without it the room is empty.
    const firstVideo = wantsNewRoom && payload?.videoId ? validateVideoId(payload.videoId) : null;
    const room = wantsNewRoom ? this.rooms.createRoom() : this.rooms.getRoom(validateRoomCode(payload.roomId));
    if (!room) throw new RoomError('Room not found. Check the code and try again.');
    if (firstVideo) room.changeVideo(firstVideo, false);
    const roomId = room.id;

    // Already in a DIFFERENT room on this socket? Leave it first. Re-joining the same room with the
    // same session (e.g. Home created it, then the room page joins) is just a reconnect, not a leave.
    const sameSeat = socket.data.roomId === roomId && socket.data.participantId === sessionId;
    if (socket.data.roomId && !sameSeat) this.onLeaveRoom(socket);

    const existing = room.getParticipant(sessionId);
    let me;
    if (existing) {
      // Reconnect. Kick the stale socket if it's somehow still connected (two tabs, same session).
      if (existing.socketId && existing.socketId !== socket.id) {
        const stale = this.io.sockets.sockets.get(existing.socketId);
        if (stale) {
          stale.data = {};
          stale.leave(roomId);
          stale.emit('error', { message: 'You joined this room from another tab' });
        }
      }
      this.cancelGraceTimer(roomId, sessionId);
      existing.socketId = socket.id;
      me = existing;
    } else {
      me = room.addParticipant(sessionId, username, socket.id);
    }

    if (avatar) me.setAvatar(avatar);
    socket.data = { roomId, participantId: me.id };
    socket.join(roomId);

    if (typeof ack === 'function') {
      ack({
        ok: true,
        roomId,
        you: me.toDTO(roomId),
        participants: room.listParticipants(),
        requests: can(me.role, 'resolve_request') ? room.listRequests() : [],
        chat: room.chatLog,
      });
    }
    socket.emit('sync_state', room.getCurrentState());

    // Announce only genuinely new people, not refreshes.
    if (!existing) {
      this.io.to(roomId).emit('user_joined', {
        username: me.username,
        userId: me.id,
        role: me.role,
        participants: room.listParticipants(),
      });
    }
  }

  // leave_room {roomId}: user clicked Leave. Uses the room stored on the socket (never trust a client roomId).
  onLeaveRoom(socket) {
    const { roomId, participantId } = socket.data;
    if (!roomId || !participantId) return;
    socket.leave(roomId);
    socket.data = {};
    this.removeFromRoom(roomId, participantId);
  }

  // A socket dropped. Don't remove the user immediately: mark them disconnected and wait a grace
  // period so a page refresh or brief network blip keeps their seat and role.
  onDisconnect(socket) {
    const { roomId, participantId } = socket.data;
    if (!roomId || !participantId) return;
    const room = this.rooms.getRoom(roomId);
    const me = room?.getParticipant(participantId);
    if (!me || me.socketId !== socket.id) return; // already replaced by a newer connection
    me.socketId = null;
    const key = `${roomId}:${participantId}`;
    this.graceTimers.set(
      key,
      setTimeout(() => {
        this.graceTimers.delete(key);
        try {
          this.removeFromRoom(roomId, participantId);
        } catch (err) {
          // A timer runs outside any socket handler, so an error here would crash the whole server
          // (and wipe every room). Log it and carry on.
          console.error('Error while removing a disconnected user:', err);
        }
      }, RECONNECT_GRACE_MS),
    );
  }

  cancelGraceTimer(roomId, participantId) {
    const key = `${roomId}:${participantId}`;
    const timer = this.graceTimers.get(key);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(key);
  }

  // Shared by leave, disconnect-timeout and kick: removes the person, tells the room,
  // announces an automatic new Host if needed, and deletes the room if it is now empty.
  removeFromRoom(roomId, participantId, ban = false) {
    const room = this.rooms.getRoom(roomId);
    if (!room || !room.getParticipant(participantId)) return;
    const { participant, newHost, droppedRequests } = room.removeParticipant(participantId, ban);

    if (room.isEmpty) {
      this.rooms.deleteRoom(roomId);
      return;
    }

    if (!ban) {
      this.io.to(roomId).emit('user_left', {
        username: participant.username,
        userId: participant.id,
        participants: room.listParticipants(),
      });
    }
    droppedRequests.forEach((r) =>
      this.io.to(roomId).emit('request_resolved', {
        requestId: r.id,
        approved: false,
        type: r.type,
        requesterId: r.userId,
        requesterUsername: r.username,
        resolvedBy: null,
      }),
    );
    if (newHost) {
      this.io.to(roomId).emit('host_transferred', {
        oldHostId: participant.id,
        newHostId: newHost.id,
        newHostUsername: newHost.username,
        reason: 'host_left',
        participants: room.listParticipants(),
      });
      this.sendRequestList(room, newHost);
    }
  }

  // ---------- host-only actions ----------

  // assign_role {userId, role}: Host promotes/demotes someone between Moderator and Participant.
  onAssignRole(ctx, payload) {
    const target = ctx.room.assignRole(validateUserId(payload?.userId), validateAssignableRole(payload?.role));
    this.io.to(ctx.room.id).emit('role_assigned', {
      userId: target.id,
      username: target.username,
      role: target.role,
      participants: ctx.room.listParticipants(),
    });
    this.sendRequestList(ctx.room, target);
  }

  // remove_participant {userId}: Host kicks someone. They get participant_removed too (so their UI
  // can show a message), then their socket is detached from the room and its socket.data wiped,
  // so any further events from it are rejected.
  onRemoveParticipant(ctx, payload) {
    const targetId = validateUserId(payload?.userId);
    if (targetId === ctx.me.id) throw new RoomError("You can't remove yourself. Use Leave instead.");
    const target = ctx.room.requireParticipant(targetId);
    const roomId = ctx.room.id;
    const targetSocket = target.socketId ? this.io.sockets.sockets.get(target.socketId) : undefined;

    this.cancelGraceTimer(roomId, targetId);
    this.removeFromRoom(roomId, targetId, true);

    const participants = ctx.room.listParticipants();
    this.io.to(roomId).emit('participant_removed', { userId: targetId, participants });
    if (targetSocket) {
      targetSocket.emit('participant_removed', { userId: targetId, participants });
      targetSocket.leave(roomId);
      targetSocket.data = {};
    }
  }

  // transfer_host {userId}: Host hands the crown over; old Host becomes a Participant.
  onTransferHost(ctx, payload) {
    const { oldHost, newHost } = ctx.room.transferHost(ctx.me.id, validateUserId(payload?.userId));
    this.io.to(ctx.room.id).emit('host_transferred', {
      oldHostId: oldHost.id,
      newHostId: newHost.id,
      newHostUsername: newHost.username,
      reason: 'transferred',
      participants: ctx.room.listParticipants(),
    });
    this.sendRequestList(ctx.room, newHost);
  }

  // ---------- request / approval ----------

  // request_action {type, payload}: a Participant asks for a play/pause/seek/change_video.
  // Nothing changes yet; Host and Moderators get a request_pending to approve or reject.
  onRequestAction(ctx, payload, ack) {
    const { type, payload: cleaned } = validateRequest(payload?.type, payload?.payload);
    const request = ctx.room.createRequest(ctx.me, type, cleaned);
    for (const person of ctx.room.participants.values()) {
      if (person.socketId && can(person.role, 'resolve_request')) {
        this.io.to(person.socketId).emit('request_pending', { request });
      }
    }
    if (typeof ack === 'function') ack({ ok: true, requestId: request.id });
  }

  // resolve_request {requestId, approve}: Host/Moderator decides. If approved the change is applied
  // to the Room and broadcast as sync_state. Everyone (esp. the requester) gets request_resolved.
  onResolveRequest(ctx, payload) {
    if (typeof payload?.requestId !== 'string') throw new RoomError('Invalid request');
    const approve = payload.approve === true;
    const request = ctx.room.resolveRequest(payload.requestId, approve);
    this.io.to(ctx.room.id).emit('request_resolved', {
      requestId: request.id,
      approved: approve,
      type: request.type,
      requesterId: request.userId,
      requesterUsername: request.username,
      resolvedBy: ctx.me.username,
    });
    if (approve) this.broadcastState(ctx.room);
  }
}
