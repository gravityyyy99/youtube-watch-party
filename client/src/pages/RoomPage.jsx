import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AdminPanel from '../components/AdminPanel';
import Chat from '../components/Chat';
import Controls from '../components/Controls';
import Participants from '../components/Participants';
import Player from '../components/Player';
import ReactionBar from '../components/ReactionBar';
import ReactionOverlay from '../components/ReactionOverlay';
import RequestForm from '../components/RequestForm';
import { useToast } from '../components/Toasts';
import { useRoom } from '../hooks/useRoom';
import { serverUrl } from '../config';
import { getStoredAvatar, getStoredUsername, socket, storeAvatar, storeUsername } from '../socket';

import AvatarPicker from '../components/AvatarPicker';
import ProfileMenu from '../components/ProfileMenu';

// The room screen: player in the middle, participants on the side. It also handles the "shared link"
// case: if you arrive at /room/CODE without a username it asks for one, then joins.
export default function RoomPage() {
  const { id = '' } = useParams();
  const roomId = id.toUpperCase();
  const navigate = useNavigate();
  const toast = useToast();

  const [username, setUsername] = useState(getStoredUsername());
  const [nameInput, setNameInput] = useState('');
  const [photo, setPhoto] = useState(getStoredAvatar()); // optional, chosen on the join prompt
  // null = still checking whether the room exists
  const [adminOpen, setAdminOpen] = useState(false);
  const [exists, setExists] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(serverUrl(`/api/rooms/${encodeURIComponent(roomId)}`))
      .then((r) => r.json())
      .then((data) => alive && setExists(Boolean(data.exists)))
      .catch(() => alive && setExists(false));
    return () => {
      alive = false;
    };
  }, [roomId]);

  const { status, error, me, participants, sync, connected, requests, chat, reactions } = useRoom(
    roomId,
    exists && username ? username : null,
    toast,
  );

  // Removed by the host: the hook flips status to "removed"; show a message, then go Home.
  useEffect(() => {
    if (status !== 'removed') return;
    toast('You were removed from the room by the host', 'error');
    const t = setTimeout(() => navigate('/'), 3000);
    return () => clearTimeout(t);
  }, [status, navigate, toast]);

  // ---- emit helpers: just send the event; the server decides whether it is allowed ----
  const play = () => socket.emit('play');
  const pause = () => socket.emit('pause');
  const seek = (time) => socket.emit('seek', { time });
  const changeVideo = (videoId) => socket.emit('change_video', { videoId });
  const assignRole = (userId, role) => socket.emit('assign_role', { userId, role });
  const removeParticipant = (userId) => socket.emit('remove_participant', { userId });
  const transferHost = (userId) => socket.emit('transfer_host', { userId });

  // Participant asks for a change; the server replies via ack, then waits for a Host/Moderator.
  const requestAction = (type, payload) =>
    socket.emit('request_action', { type, payload }, (res) => {
      if (res?.ok) toast('Request sent. Waiting for the Host or a Moderator.');
    });
  const resolveRequest = (requestId, approve) => socket.emit('resolve_request', { requestId, approve });
  const sendReaction = (emoji) => socket.emit('send_reaction', { emoji });
  const sendChat = (text) => socket.emit('chat_message', { text });
  // Change or remove my profile picture (null removes). Remembered so a refresh keeps it.
  const updateProfile = (avatar) => {
    storeAvatar(avatar);
    socket.emit('update_profile', { avatar });
  };

  const leave = () => {
    socket.emit('leave_room', { roomId });
    navigate('/');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
      toast('Room link copied', 'success');
    } catch {
      toast(`Copy failed. Share this code: ${roomId}`, 'error');
    }
  };

  const submitName = (e) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) return toast('Please enter a username', 'error');
    storeUsername(name);
    storeAvatar(photo);
    setUsername(name);
  };

  // ---- screens before / instead of the room ----
  if (exists === null) return <Message title="Loading…" />;
  if (exists === false)
    return (
      <Message title="Room not found" text={`There is no room with code ${roomId}. It may have ended.`}>
        <Link className="btn btn-primary" to="/">
          Back to home
        </Link>
      </Message>
    );

  if (!username)
    return (
      <main className="home">
        <form className="home-card" onSubmit={submitName}>
          <h1 className="logo">Join room {roomId}</h1>
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={nameInput}
              maxLength={20}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
            />
          </label>
          <AvatarPicker name={nameInput} value={photo} onChange={setPhoto} onError={(msg) => toast(msg, 'error')} />
          <button className="btn btn-primary btn-wide" type="submit">
            Join
          </button>
        </form>
      </main>
    );

  if (status === 'error')
    return (
      <Message title="Couldn't join" text={error}>
        <button className="btn" onClick={() => setUsername('')}>
          Try another name
        </button>
        <Link className="btn btn-primary" to="/">
          Back to home
        </Link>
      </Message>
    );

  if (status === 'ended')
    return (
      <Message
        title="This room has ended"
        text="The server restarted or everyone left, so the room was closed. Rooms are kept in memory, so a restart (for example a new deployment) clears them. Start a new room to keep watching."
      >
        <Link className="btn btn-primary" to="/">
          Create a new room
        </Link>
      </Message>
    );

  if (status === 'removed')
    return <Message title="You were removed" text="The host removed you from this room. Taking you home…" />;
  if (status === 'connecting' || !me) return <Message title="Joining room…" />;

  const canControl = me.role === 'host' || me.role === 'moderator';

  return (
    <div className="room">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">
            <span className="brand-mark">▶</span>
            <span className="brand-text">WatchParty</span>
          </span>
        </div>
        <div className="topbar-center">
          <span className="chip">
            Room <code>{roomId}</code>
          </span>
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={copyLink}>
            🔗 <span className="hide-sm">Share</span>
          </button>
          {canControl && (
            <button className="btn" onClick={() => setAdminOpen(true)}>
              🛡 <span className="hide-sm">Admin</span>
              {requests.length > 0 && <span className="notif">{requests.length}</span>}
            </button>
          )}
          <button className="btn" onClick={leave}>
            Leave
          </button>
          <ProfileMenu me={me} onChange={updateProfile} onError={(msg) => toast(msg, 'error')} />
        </div>
      </header>

      {!connected && <div className="banner">Connection lost. Reconnecting…</div>}

      <div className="watch">
        <main className="watch-primary">
          <div className="player-wrap">
            <Player sync={sync} canControl={canControl} onPlay={play} onPause={pause} onSeek={seek} />
            <ReactionOverlay reactions={reactions} />
          </div>

          <h1 className="watch-title">
            {sync?.videoId ? 'Watch party' : 'Waiting for a video'} · {roomId}
          </h1>
          <div className="watch-meta">
            <span className={`live-pill ${connected ? '' : 'live-off'}`}>
              <span className="live-dot" /> {connected ? 'LIVE' : 'OFFLINE'}
            </span>
            <span>{participants.length} watching now</span>
            <span className={`badge badge-${me.role}`}>You: {me.role === 'participant' ? 'Viewer' : me.role}</span>
          </div>

          <ReactionBar onReact={sendReaction} />

          <Controls
            sync={sync}
            canControl={canControl}
            onPlay={play}
            onPause={pause}
            onSeek={seek}
            onChangeVideo={changeVideo}
            onInvalidLink={() => toast('That is not a valid YouTube link', 'error')}
          >
            {!canControl && <RequestForm onSubmit={requestAction} onInvalid={(msg) => toast(msg, 'error')} />}
          </Controls>

          <section className="card">
            <h2 className="card-title">
              Watching now <span className="count">{participants.length}</span>
            </h2>
            <Participants participants={participants} myId={me.id} myRole={me.role} />
          </section>
        </main>

        <aside className="watch-secondary">
          <Chat messages={chat} participants={participants} myId={me.id} connected={connected} onSend={sendChat} />
        </aside>
      </div>

      {adminOpen && canControl && (
        <AdminPanel
          roomId={roomId}
          me={me}
          participants={participants}
          requests={requests}
          onClose={() => setAdminOpen(false)}
          onCopyLink={copyLink}
          onResolveRequest={resolveRequest}
          onAssignRole={assignRole}
          onRemove={removeParticipant}
          onTransferHost={transferHost}
        />
      )}
    </div>
  );
}

// Simple centered message screen.
function Message({ title, text, children }) {
  return (
    <main className="home">
      <div className="home-card center">
        <h1 className="logo">{title}</h1>
        {text && <p className="tagline">{text}</p>}
        <div className="stack">{children}</div>
      </div>
    </main>
  );
}
