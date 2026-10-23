const ID_PATTERN = /^[\w-]{11}$/;

// Pulls the 11-character video id out of a pasted YouTube link. Returns null if it isn't a
// YouTube video link, so the caller can show "Invalid link". Supported:
//   https://youtu.be/ID            https://www.youtube.com/watch?v=ID
//   https://www.youtube.com/embed/ID    https://www.youtube.com/shorts/ID
export function extractVideoId(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null; // not a URL at all
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const match = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/);
      id = match ? match[1] : null;
    }
  }
  return id && ID_PATTERN.test(id) ? id : null;
}

// Loads the YouTube IFrame API script exactly once and resolves when `YT.Player` is usable.
let apiPromise = null;
export function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const w = window;
    if (w.YT && w.YT.Player) return resolve();
    const previous = w.onYouTubeIframeAPIReady;
    // The API calls this global function when it finishes loading.
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return apiPromise;
}
