import { useRef } from 'react';
import { fileToAvatar } from '../utils/image';
import Avatar from './Avatar';

// "Profile photo (optional)" control used before joining: preview, choose a file, remove.
export default function AvatarPicker({ name, value, onChange, onError }) {
  const fileRef = useRef(null);

  const onFile = async (file) => {
    if (!file) return;
    try {
      onChange(await fileToAvatar(file));
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <div className="avatar-picker">
      <Avatar name={name || '?'} src={value} />
      <div className="avatar-picker-text">
        <span>Profile photo (optional)</span>
        <div className="avatar-picker-actions">
          <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()}>
            {value ? 'Change' : 'Upload'}
          </button>
          {value && (
            <button type="button" className="btn btn-small" onClick={() => onChange(null)}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = ''; // allow choosing the same file again
        }}
      />
    </div>
  );
}
