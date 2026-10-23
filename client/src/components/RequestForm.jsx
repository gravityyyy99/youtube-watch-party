import { useState } from 'react';

import { parseTime } from '../utils/time';
import { extractVideoId } from '../utils/youtube';

// What a Participant sees instead of playback controls: pick a change, send it as a request.
// Nothing happens to the video until a Host or Moderator approves it.
export default function RequestForm({ onSubmit, onInvalid }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('play');
  const [value, setValue] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (type === 'seek') {
      const time = parseTime(value);
      if (time === null) return onInvalid('Enter a time like 90 or 1:30');
      onSubmit('seek', { time });
    } else if (type === 'change_video') {
      const videoId = extractVideoId(value);
      if (!videoId) return onInvalid('That is not a valid YouTube link');
      onSubmit('change_video', { videoId });
    } else {
      onSubmit(type, {});
    }
    setValue('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        ✋ Request change
      </button>
    );
  }

  return (
    <form className="control-row" onSubmit={submit}>
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Request type">
        <option value="play">Play</option>
        <option value="pause">Pause</option>
        <option value="seek">Seek to…</option>
        <option value="change_video">Change video…</option>
      </select>
      {type === 'seek' && (
        <input type="text" placeholder="1:30" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      )}
      {type === 'change_video' && (
        <input
          type="text"
          placeholder="YouTube link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      )}
      <button className="btn btn-primary" type="submit">
        Send request
      </button>
      <button className="btn" type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
