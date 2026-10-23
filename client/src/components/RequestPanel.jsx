import { formatTime } from '../utils/time';

// Plain-English description of what a request would do.
function describe(r) {
  switch (r.type) {
    case 'play':
      return 'wants to play the video';
    case 'pause':
      return 'wants to pause the video';
    case 'seek':
      return `wants to jump to ${formatTime(r.payload.time ?? 0)}`;
    case 'change_video':
      return `wants to play youtu.be/${r.payload.videoId}`;
  }
}

// Requests from Viewers waiting for a decision (shown inside the Admin panel to Host/Moderators).
// The server applies a change only after "Approve"; "Reject" just discards it.
export default function RequestPanel({ requests, onResolve }) {
  if (requests.length === 0) return <p className="empty">No pending requests</p>;
  return (
    <ul className="requests">
      {requests.map((r) => (
        <li key={r.id} className="request">
          <p>
            <strong>{r.username}</strong> {describe(r)}
          </p>
          <div className="person-actions">
            <button className="btn btn-small btn-primary" onClick={() => onResolve(r.id, true)}>
              Approve
            </button>
            <button className="btn btn-small" onClick={() => onResolve(r.id, false)}>
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
