import { useEffect, useRef, useState } from 'react';

import { formatTime, currentPosition } from '../utils/time';
import { loadYouTubeApi } from '../utils/youtube';

// If we are further than this (seconds) from the server's time, we jump to the server's time.
const DRIFT_THRESHOLD = 1.5;
// A local jump bigger than this that nobody asked for means the user scrubbed the timeline.
const SEEK_DETECT_THRESHOLD = 1.5;
const POLL_MS = 500;
// How long after we move the player ourselves its own state callbacks are ignored.
const REMOTE_FLAG_MS = 900;

// Wraps the YouTube IFrame Player. It does two jobs:
//   1. APPLY server state to the player (play/pause/seek/load video) - "remote updates".
//   2. For Host/Moderator, REPORT the user's own play/pause/seek to the server.
// The hard part is not mixing them up: when we call player.playVideo() because the server said so,
// the player fires a state-change callback, which must NOT be sent back to the server (an infinite
// echo loop). That is what `remoteRef` prevents.
export default function Player({ sync, canControl, onPlay, onPause, onSeek }) {
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const loadedVideoRef = useRef(null);

  // "Remote update" flag: true while WE are driving the player because of a server event.
  const remoteRef = useRef(false);
  const remoteTimerRef = useRef(undefined);
  const pauseTimerRef = useRef(undefined);
  const ignoreDriftUntilRef = useRef(0);
  const lastPollRef = useRef({ time: 0, at: Date.now() });
  const notPlayingPollsRef = useRef(0);
  const [needsTap, setNeedsTap] = useState(false);

  // Timers and YouTube callbacks are created once, so they read the newest props/state via refs.
  const syncRef = useRef(sync);
  const propsRef = useRef({ canControl, onPlay, onPause, onSeek });
  propsRef.current = { canControl, onPlay, onPause, onSeek };

  // Runs `fn` (which moves the player) with the remote flag raised, then lowers it a moment later,
  // after the player's asynchronous state callbacks have fired.
  const runRemote = (fn) => {
    remoteRef.current = true;
    window.clearTimeout(remoteTimerRef.current);
    fn();
    const player = playerRef.current;
    if (player) lastPollRef.current = { time: player.getCurrentTime(), at: Date.now() };
    remoteTimerRef.current = window.setTimeout(() => {
      remoteRef.current = false;
    }, REMOTE_FLAG_MS);
  };

  // Makes the player match the latest server state: load a new video, jump to the right second,
  // then play or pause. Called whenever a sync_state arrives and once when the player is ready.
  const applyServerState = () => {
    const player = playerRef.current;
    const state = syncRef.current;
    // No video chosen yet: nothing to load (the empty-state message is shown instead).
    if (!player || !readyRef.current || !state || !state.videoId) return;
    const videoId = state.videoId;
    runRemote(() => {
      const target = currentPosition(state);
      if (loadedVideoRef.current !== videoId) {
        loadedVideoRef.current = videoId;
        // load = start playing, cue = show the video but stay paused
        if (state.playState === 'playing') player.loadVideoById({ videoId, startSeconds: target });
        else player.cueVideoById({ videoId, startSeconds: target });
        return;
      }
      if (Math.abs(player.getCurrentTime() - target) > 0.5) player.seekTo(target, true);
      if (state.playState === 'playing') player.playVideo();
      else player.pauseVideo();
    });
  };

  // Create the YouTube player once.
  useEffect(() => {
    let cancelled = false;
    let interval;

    // YouTube's own state changes. Only Host/Moderator may report them, and only when the change
    // came from the user (flag down) and actually differs from what the server already believes.
    const onStateChange = (e) => {
      if (remoteRef.current || !propsRef.current.canControl) return;
      const serverPlaying = syncRef.current?.playState === 'playing';
      if (e.data === YT.PlayerState.PLAYING && !serverPlaying) {
        window.clearTimeout(pauseTimerRef.current);
        propsRef.current.onPlay();
      } else if (e.data === YT.PlayerState.PAUSED && serverPlaying) {
        // Scrubbing makes YouTube briefly report PAUSED; wait a moment and only report a real pause.
        window.clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = window.setTimeout(() => {
          if (!remoteRef.current && playerRef.current?.getPlayerState() === YT.PlayerState.PAUSED)
            propsRef.current.onPause();
        }, 300);
      }
    };

    // Runs twice a second: detects scrubbing, corrects drift, and spots blocked autoplay.
    const tick = () => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      const now = Date.now();
      const time = player.getCurrentTime();
      const playerState = player.getPlayerState();
      const target = syncRef.current;

      if (remoteRef.current) {
        lastPollRef.current = { time, at: now };
        return;
      }

      // YouTube has no "seeked" event, so detect it: position differs from where it should be.
      const last = lastPollRef.current;
      const expected = last.time + (playerState === YT.PlayerState.PLAYING ? (now - last.at) / 1000 : 0);
      if (propsRef.current.canControl && Math.abs(time - expected) > SEEK_DETECT_THRESHOLD) {
        propsRef.current.onSeek(time);
        ignoreDriftUntilRef.current = now + 2500; // don't snap back before the server echoes our seek
      }
      lastPollRef.current = { time, at: now };

      // Drift correction.
      if (
        target &&
        target.playState === 'playing' &&
        playerState === YT.PlayerState.PLAYING &&
        now > ignoreDriftUntilRef.current
      ) {
        const serverTime = currentPosition(target);
        if (Math.abs(time - serverTime) > DRIFT_THRESHOLD) runRemote(() => player.seekTo(serverTime, true));
      }

      // Browsers can block autoplay; if the server says "playing" but we sit idle, offer a button.
      const idle = [YT.PlayerState.UNSTARTED, YT.PlayerState.CUED, YT.PlayerState.PAUSED].includes(playerState);
      if (target?.playState === 'playing' && idle) {
        notPlayingPollsRef.current += 1;
        if (notPlayingPollsRef.current >= 4) setNeedsTap(true);
      } else {
        notPlayingPollsRef.current = 0;
        setNeedsTap(false);
      }
    };

    loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current) return;
      // YouTube replaces the element we give it, so hand it a fresh child, not our React-owned div.
      const holder = document.createElement('div');
      mountRef.current.appendChild(holder);
      playerRef.current = new YT.Player(holder, {
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            applyServerState();
          },
          onStateChange,
        },
      });
      interval = window.setInterval(tick, POLL_MS);
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(remoteTimerRef.current);
      window.clearTimeout(pauseTimerRef.current);
      readyRef.current = false;
      loadedVideoRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
      if (mountRef.current) mountRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every new server state is applied to the player.
  useEffect(() => {
    syncRef.current = sync;
    applyServerState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  // Button shown when the browser blocked autoplay: a real click lets the video start.
  const startPlayback = () => {
    runRemote(() => {
      const state = syncRef.current;
      const player = playerRef.current;
      if (state) player?.seekTo(currentPosition(state), true);
      player?.playVideo();
    });
    setNeedsTap(false);
  };

  return (
    <div className="player-frame">
      <div className="player-mount" ref={mountRef} />
      {/* A new room has no video until the Host (or a Moderator) pastes a YouTube link. */}
      {sync && !sync.videoId && (
        <div className="player-empty">
          <div className="player-empty-icon">▶</div>
          <h2>No video yet</h2>
          <p>
            {canControl
              ? 'Paste any YouTube link below to start the party.'
              : 'Waiting for the Host to pick a video. You can also ask with "Request change".'}
          </p>
        </div>
      )}
      {/* Participants can't click the video (which would pause it locally and desync them). */}
      {!canControl && <div className="player-shield" title="Only the Host and Moderators can control playback" />}
      {needsTap && (
        <button className="btn btn-primary player-tap" onClick={startPlayback}>
          Click to start playback{sync ? ` (${formatTime(currentPosition(sync))})` : ''}
        </button>
      )}
    </div>
  );
}
