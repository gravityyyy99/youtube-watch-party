import { useState } from 'react';

import { currentPosition } from '../utils/time';
import { extractVideoId } from '../utils/youtube';

// Play / pause / skip buttons plus the "paste a YouTube link" box. Everything is disabled unless
// I'm Host or Moderator (the server enforces this too; disabling is just so the UI is honest).
export default function Controls({
  sync,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onChangeVideo,
  onInvalidLink,
  children,
}) {
  const [link, setLink] = useState('');
  const playing = sync?.playState === 'playing';
  const hasVideo = Boolean(sync?.videoId); // play/skip need a video; pasting a link does not

  // Skips relative to the position the server thinks we're at.
  const skip = (delta) => sync && onSeek(Math.max(0, currentPosition(sync) + delta));

  const submitLink = (e) => {
    e.preventDefault();
    const id = extractVideoId(link);
    if (!id) return onInvalidLink();
    onChangeVideo(id);
    setLink('');
  };

  return (
    <div className="controls">
      <div className="control-row">
        <button className="btn" disabled={!canControl || !hasVideo} onClick={() => skip(-10)}>
          ⏪ 10s
        </button>
        <button className="btn btn-primary" disabled={!canControl || !hasVideo} onClick={playing ? onPause : onPlay}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="btn" disabled={!canControl || !hasVideo} onClick={() => skip(10)}>
          10s ⏩
        </button>
        {!canControl && <span className="hint">Only the Host and Moderators control playback</span>}
      </div>

      {children}

      <form className="control-row" onSubmit={submitLink}>
        <input
          type="text"
          placeholder={hasVideo ? 'Paste a YouTube link to change the video' : 'Paste a YouTube link to start'}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={!canControl}
          aria-label="YouTube link"
        />

        <button className="btn" type="submit" disabled={!canControl || link.trim() === ''}>
          Change video
        </button>
      </form>
    </div>
  );
}
