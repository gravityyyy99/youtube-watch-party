const COLORS = ['#c2410c', '#0e7490', '#7c3aed', '#be185d', '#15803d', '#b45309', '#1d4ed8', '#9f1239'];

// Gives every username the same colour every time (like YouTube's coloured profile circles),
// by turning the name into a number and using it to pick from a fixed palette.
export function avatarColor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}
