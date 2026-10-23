import Avatar from './Avatar';

const ROLE_LABEL = { host: 'Host', moderator: 'Moderator', participant: 'Viewer' };

// List of everyone in the room with a role badge. On the watch page it is read-only ("Watching now").
// With `manage`, and only if I am the Host, each other person also gets, right beside their name, a
// "Make moderator" / "Remove moderator" button, plus a role dropdown, Make host and Remove.
// (Hiding the buttons is only convenience: the server rejects these events from anyone but the Host.)
export default function Participants({
  participants,
  myId,
  myRole,
  manage = false,
  onAssignRole,
  onRemove,
  onTransferHost,
}) {
  const canManage = manage && myRole === 'host';

  return (
    <ul className="people">
      {participants.map((p) => (
        <li key={p.id} className="person">
          <div className="person-main">
            <Avatar name={p.username} src={p.avatar} />
            <span className="person-name">
              {p.username}
              {p.id === myId && <span className="you"> (you)</span>}
            </span>
            <span className={`badge badge-${p.role}`}>{ROLE_LABEL[p.role]}</span>
            {canManage && p.id !== myId && (
              <button
                className={`btn btn-small ${p.role === 'moderator' ? '' : 'btn-primary'}`}
                onClick={() => onAssignRole?.(p.id, p.role === 'moderator' ? 'participant' : 'moderator')}
              >
                {p.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}
              </button>
            )}
          </div>

          {canManage && p.id !== myId && (
            <div className="person-actions">
              <select
                aria-label={`Role for ${p.username}`}
                value={p.role}
                onChange={(e) => onAssignRole?.(p.id, e.target.value)}
              >
                <option value="participant">Viewer</option>
                <option value="moderator">Moderator</option>
              </select>
              <button
                className="btn btn-small"
                onClick={() =>
                  window.confirm(`Make ${p.username} the Host? You will become a Viewer.`) && onTransferHost?.(p.id)
                }
              >
                Make host
              </button>
              <button
                className="btn btn-small btn-danger"
                onClick={() => window.confirm(`Remove ${p.username} from the room?`) && onRemove?.(p.id)}
              >
                Remove
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
