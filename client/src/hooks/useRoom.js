import { useEffect, useRef, useState } from 'react';
import { emitJoin, socket } from '../socket';

const ROLE_LABEL = { host: 'Host', moderator: 'Moderator', participant: 'Viewer' };

// Owns the socket connection for one room: joins it, listens to every server event and turns them
// into React state (participants, my role, current video state). Components just read this state,
// so all the "what does event X do" logic lives in this one file.
export function useRoom(roomId, username, notify) {
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [myId, setMyId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [sync, setSync] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [requests, setRequests] = useState([]); // only filled for Host/Moderator
  const [chat, setChat] = useState([]);
  const [reactions, setReactions] = useState([]); // emojis currently floating over the player

  // Refs let socket callbacks (created once) read the latest values without re-subscribing.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const myIdRef = useRef(null);
  const participantsRef = useRef([]); // latest list, so handlers can look up a name
  participantsRef.current = participants;
  const statusRef = useRef('connecting');
  const joinedBeforeRef = useRef(false); // true once we have been inside this room at least once
  const setStatusBoth = (s) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    if (!username) return;
    let active = true;
    setStatusBoth('connecting'); // fresh attempt (e.g. user picked another name after an error)
    setError('');

    // (Re)join the room. Runs on first connect and again after any reconnect (network blip,
    // server restart); the server recognises our session id and gives us our old seat back.
    const join = async () => {
      const res = await emitJoin(roomId, username);
      if (!active) return;
      if (res.ok && res.you && res.participants) {
        myIdRef.current = res.you.id;
        setMyId(res.you.id);
        setParticipants(res.participants);
        setRequests(res.requests ?? []);
        setChat(res.chat ?? []);
        setError('');
        joinedBeforeRef.current = true;
        setStatusBoth('joined');
      } else if (joinedBeforeRef.current && /room not found/i.test(res.message ?? '')) {
        // We were in this room a moment ago and now it is gone: the server restarted (for example a new
        // deployment) or everyone left. Rooms live in memory, so that clears them. Say so clearly.
        setStatusBoth('ended');
      } else {
        setError(res.message ?? 'Could not join the room');
        setStatusBoth('error');
      }
    };

    const onConnect = () => {
      setConnected(true);
      void join();
    };
    const onDisconnect = () => setConnected(false);

    // Updates the sidebar list and keeps track of what changed about ME for friendly toasts.
    const announceMyRole = (list, text) => {
      const me = list.find((p) => p.id === myIdRef.current);
      const message = me && text(me.role);
      if (message) notifyRef.current(message, 'success');
    };

    // Adds a grey "X joined" style line into the live chat, so everyone sees room activity as it happens.
    const addSystemLine = (text) =>
      setChat((list) => [
        ...list.slice(-199),
        {
          id: `sys-${Date.now()}-${Math.random()}`,
          userId: '',
          username: '',
          text,
          timestamp: Date.now(),
          system: true,
        },
      ]);

    const onUserJoined = (p) => {
      setParticipants(p.participants);
      if (p.userId !== myIdRef.current) {
        notifyRef.current(`${p.username} joined`);
        addSystemLine(`${p.username} joined the party`);
      }
    };
    const onUserLeft = (p) => {
      setParticipants(p.participants);
      notifyRef.current(`${p.username} left`);
      addSystemLine(`${p.username} left`);
    };
    const onRoleAssigned = (p) => {
      setParticipants(p.participants);
      if (p.userId === myIdRef.current) notifyRef.current(`You are now a ${ROLE_LABEL[p.role]}`, 'success');
      else notifyRef.current(`${p.username} is now a ${ROLE_LABEL[p.role]}`);
      addSystemLine(`${p.username} is now a ${ROLE_LABEL[p.role]}`);
    };
    const onHostTransferred = (p) => {
      setParticipants(p.participants);
      if (p.newHostId === myIdRef.current) announceMyRole(p.participants, () => 'You are now the Host');
      else notifyRef.current(`${p.newHostUsername} is now the Host`);
      addSystemLine(`${p.newHostUsername} is now the Host`);
    };
    const onParticipantRemoved = (p) => {
      const removedName = participantsRef.current.find((x) => x.id === p.userId)?.username;
      setParticipants(p.participants);
      if (removedName && p.userId !== myIdRef.current) addSystemLine(`${removedName} was removed`);
      if (p.userId === myIdRef.current) setStatusBoth('removed');
    };
    // Someone changed their profile picture: refresh the lists so every avatar updates live.
    const onProfileUpdated = (p) => setParticipants(p.participants);
    const onSyncState = (s) => setSync({ ...s, receivedAt: Date.now() });
    // A Participant asked for something (sent only to Host/Moderators): add it to the panel.
    const onRequestPending = ({ request }) => {
      setRequests((list) => (list.some((r) => r.id === request.id) ? list : [...list, request]));
      notifyRef.current(`${request.username} sent a request`);
    };
    // Sent when I become Host/Moderator, so I also see requests made before that.
    const onRequestList = ({ requests: list }) => setRequests(list);
    // A request was approved or rejected (or dropped because its author left): remove it from the
    // panel, and tell the person who made it what happened.
    const onRequestResolved = (r) => {
      setRequests((list) => list.filter((x) => x.id !== r.requestId));
      if (r.requesterId === myIdRef.current && r.resolvedBy) {
        if (r.approved) notifyRef.current(`Your request was approved by ${r.resolvedBy}`, 'success');
        else notifyRef.current(`Your request was rejected by ${r.resolvedBy}`, 'error');
      }
    };
    // Someone sent an emoji: show it floating over the player for a few seconds, then remove it.
    const onReaction = (r) => {
      setReactions((list) => [...list.slice(-30), { ...r, left: 8 + Math.random() * 84 }]);
      setTimeout(() => setReactions((list) => list.filter((x) => x.id !== r.id)), 3500);
    };
    const onChatMessage = (m) => setChat((list) => [...list.slice(-199), m]);
    // Errors during join are shown on the error screen instead of as a toast.
    const onError = (e) => {
      if (statusRef.current === 'joined') notifyRef.current(e.message, 'error');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);
    socket.on('role_assigned', onRoleAssigned);
    socket.on('host_transferred', onHostTransferred);
    socket.on('participant_removed', onParticipantRemoved);
    socket.on('sync_state', onSyncState);
    socket.on('profile_updated', onProfileUpdated);
    socket.on('error', onError);
    socket.on('request_pending', onRequestPending);
    socket.on('request_list', onRequestList);
    socket.on('request_resolved', onRequestResolved);
    socket.on('chat_message', onChatMessage);
    socket.on('reaction', onReaction);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      active = false;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('role_assigned', onRoleAssigned);
      socket.off('host_transferred', onHostTransferred);
      socket.off('participant_removed', onParticipantRemoved);
      socket.off('sync_state', onSyncState);
      socket.off('profile_updated', onProfileUpdated);
      socket.off('error', onError);
      socket.off('request_pending', onRequestPending);
      socket.off('request_list', onRequestList);
      socket.off('request_resolved', onRequestResolved);
      socket.off('chat_message', onChatMessage);
      socket.off('reaction', onReaction);
    };
  }, [roomId, username]);

  const me = participants.find((p) => p.id === myId) ?? null;
  // If I was demoted to Participant, the old request list must disappear from my screen.
  const canResolve = me?.role === 'host' || me?.role === 'moderator';
  return { status, error, me, participants, sync, connected, requests: canResolve ? requests : [], chat, reactions };
}
