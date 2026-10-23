import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toasts';
import AvatarPicker from '../components/AvatarPicker';
import { connectAndJoin, getStoredAvatar, getStoredUsername, storeAvatar, storeUsername } from '../socket';
import { extractVideoId } from '../utils/youtube';

// Landing page: pick a username, then either create a room or join one with a code (or pasted link).
export default function Home() {
  const navigate = useNavigate();
  const toast = useToast();
  const [username, setUsername] = useState(getStoredUsername());
  const [code, setCode] = useState('');
  const [videoLink, setVideoLink] = useState(''); // optional first video when creating a room
  const [busy, setBusy] = useState(false);
  // Optional profile photo. It is saved straight away because joining reads it from storage.
  const [photo, setPhoto] = useState(getStoredAvatar());
  const changePhoto = (dataUrl) => {
    setPhoto(dataUrl);
    storeAvatar(dataUrl);
  };

  // Accepts "abc123" or a whole pasted link like https://site/room/ABC123.
  const parseCode = (value) => value.trim().split('/').filter(Boolean).pop()?.toUpperCase() ?? '';

  const requireName = () => {
    const name = username.trim();
    if (!name) {
      toast('Please enter a username first', 'error');
      return null;
    }
    return name;
  };

  // Create: join_room with no roomId. The server makes a room and we become its Host.
  const createRoom = async () => {
    const name = requireName();
    if (!name) return;
    // Optional: the creator may choose the first video now (any YouTube link), or paste one later.
    let videoId;
    if (videoLink.trim()) {
      videoId = extractVideoId(videoLink) ?? undefined;
      if (!videoId) return toast('That is not a valid YouTube link', 'error');
    }
    setBusy(true);
    try {
      const res = await connectAndJoin(undefined, name, videoId);
      if (!res.ok || !res.roomId) return toast(res.message ?? 'Could not create a room', 'error');
      storeUsername(name);
      navigate(`/room/${res.roomId}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Join: just go to the room page; it checks the room exists and does the actual join.
  const joinRoom = (e) => {
    e.preventDefault();
    const name = requireName();
    if (!name) return;
    const roomId = parseCode(code);
    if (!roomId) return toast('Enter a room code', 'error');
    storeUsername(name);
    navigate(`/room/${roomId}`);
  };

  return (
    <main className="home">
      <div className="home-card">
        <h1 className="logo">
          <span className="logo-mark">▶</span> Watch Party
        </h1>
        <p className="tagline">Watch YouTube together, perfectly in sync.</p>

        <label className="field">
          <span>Your name</span>
          <input
            type="text"
            value={username}
            maxLength={20}
            placeholder="e.g. Alex"
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>

        <AvatarPicker name={username} value={photo} onChange={changePhoto} onError={(msg) => toast(msg, 'error')} />

        <label className="field">
          <span>First video (optional)</span>
          <input
            type="text"
            value={videoLink}
            placeholder="Paste a YouTube link, or add one later"
            onChange={(e) => setVideoLink(e.target.value)}
          />
        </label>

        <button className="btn btn-primary btn-wide" onClick={createRoom} disabled={busy}>
          {busy ? 'Creating…' : 'Create room'}
        </button>

        <div className="divider">
          <span>or join a friend</span>
        </div>

        <form className="join-form" onSubmit={joinRoom}>
          <input
            type="text"
            value={code}
            placeholder="Room code or link"
            onChange={(e) => setCode(e.target.value)}
            aria-label="Room code"
          />

          <button className="btn" type="submit">
            Join room
          </button>
        </form>
      </div>
    </main>
  );
}
