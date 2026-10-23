import { useEffect, useRef, useState } from 'react';

import { fileToAvatar } from '../utils/image';
import Avatar from './Avatar';

// My avatar in the top bar. Clicking it opens a small menu to change or remove my profile picture.
export default function ProfileMenu({ me, onChange, onError }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef(null);
  const boxRef = useRef(null);

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const onFile = async (file) => {
    if (!file) return;
    try {
      onChange(await fileToAvatar(file));
      setOpen(false);
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <div className="profile-menu" ref={boxRef}>
      <button
        className="avatar-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile menu"
        title={`${me.username} (${me.role})`}
      >
        <Avatar name={me.username} src={me.avatar} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <Avatar name={me.username} src={me.avatar} />
            <div>
              <strong>{me.username}</strong>
              <div className="hint">{me.role === 'participant' ? 'Viewer' : me.role}</div>
            </div>
          </div>
          <button className="menu-item" onClick={() => fileRef.current?.click()}>
            📷 {me.avatar ? 'Change photo' : 'Upload photo'}
          </button>
          {me.avatar && (
            <button
              className="menu-item"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              🗑 Remove photo
            </button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
