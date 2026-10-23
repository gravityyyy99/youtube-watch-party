import { useEffect, useState } from 'react';

import Participants from './Participants';
import RequestPanel from './RequestPanel';

// The admin drawer, opened from the top bar by Host and Moderators. It gathers everything an admin
// needs in one place: room stats, pending requests to approve/reject, and (Host only) member
// management. Who sees what is only a UI convenience; the server checks permission on every event.
export default function AdminPanel(props) {
  const { roomId, me, participants, requests, onClose } = props;
  const isHost = me.role === 'host';
  const count = (role) => participants.filter((p) => p.role === role).length;

  // Search box above the member list: filters by name as you type (case-insensitive).
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const shown = query ? participants.filter((p) => p.username.toLowerCase().includes(query)) : participants;

  // Escape closes the drawer.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="Admin panel" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <h2>🛡 Admin panel</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close admin panel">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          <section className="admin-section">
            <h3>Room</h3>
            <div className="stats">
              <div className="stat">
                <strong>{participants.length}</strong>
                <span>Watching</span>
              </div>
              <div className="stat">
                <strong>{count('moderator')}</strong>
                <span>Moderators</span>
              </div>
              <div className="stat">
                <strong>{requests.length}</strong>
                <span>Pending</span>
              </div>
            </div>
            <div className="room-info">
              <span>
                Code <code className="room-code">{roomId}</code>
              </span>
              <button className="btn btn-small" onClick={props.onCopyLink}>
                🔗 Copy invite link
              </button>
            </div>
          </section>

          <section className="admin-section">
            <h3>
              Pending requests <span className="count">{requests.length}</span>
            </h3>
            <RequestPanel requests={requests} onResolve={props.onResolveRequest} />
          </section>

          <section className="admin-section">
            <h3>
              Members <span className="count">{participants.length}</span>
            </h3>
            <input
              type="search"
              className="search"
              placeholder="Search members by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search members"
            />

            {!isHost && <p className="empty">Only the Host can change roles or remove people.</p>}
            {shown.length === 0 && <p className="empty">No member matches "{search.trim()}"</p>}
            <Participants
              participants={shown}
              myId={me.id}
              myRole={me.role}
              manage
              onAssignRole={props.onAssignRole}
              onRemove={props.onRemove}
              onTransferHost={props.onTransferHost}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}
