// The same list the server accepts (server/src/validators.ts ALLOWED_REACTIONS).
const EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🔥', '🎉', '😢'];

// A row of emoji buttons under the player. Everyone (Host, Moderator, Viewer) can use them; the
// emoji then floats over every person's player.
export default function ReactionBar({ onReact }) {
  return (
    <div className="reaction-bar" role="group" aria-label="Send a reaction">
      {EMOJIS.map((emoji) => (
        <button key={emoji} className="reaction-btn" onClick={() => onReact(emoji)} aria-label={`React with ${emoji}`}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
