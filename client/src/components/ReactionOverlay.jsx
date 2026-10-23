// Emojis that float up over the video. It sits on top of the player but ignores the mouse
// (pointer-events: none in the CSS) so it never blocks the player's controls.
export default function ReactionOverlay({ reactions }) {
  return (
    <div className="reaction-overlay" aria-hidden="true">
      {reactions.map((r) => (
        <span key={r.id} className="reaction-float" style={{ left: `${r.left}%` }} title={r.username}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
