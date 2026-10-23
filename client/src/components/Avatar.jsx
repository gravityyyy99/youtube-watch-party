import { avatarColor } from '../utils/avatar';

// A round profile picture. Without a picture it shows the first letter of the name on a colour
// that is always the same for that name, like YouTube's default avatars.
export default function Avatar({ name, src, small = false }) {
  const cls = `avatar${small ? ' avatar-sm' : ''}`;
  if (src) return <img className={cls} src={src} alt={name} />;
  return (
    <span className={cls} style={{ background: avatarColor(name) }} aria-label={name}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
