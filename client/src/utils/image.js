const SIZE = 128; // avatars are shown tiny, so we shrink pictures to 128x128 before uploading
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

// Turns a chosen image file into a small square JPEG data URL (centre-cropped).
// Doing this in the browser keeps uploads to a few KB and means the server only ever sees JPEGs.
// Rejects with a readable message if the file isn't an image.
export function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
    if (file.size > MAX_INPUT_BYTES) return reject(new Error('That image is too large (max 10 MB)'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height); // largest centred square
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not process that image'));
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}
