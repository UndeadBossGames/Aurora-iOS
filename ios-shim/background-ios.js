// Aurora for iPhone: keep the music going when you leave the app or lock the phone.
// iOS lets audio play in the background, but it pauses anything playing in a <video> element (and
// Aurora plays everything, including music videos, in one <video> element). So when the app goes to
// the background, the sound is handed to a hidden <audio> element at the exact same spot; next/
// previous, play/pause and seeking from the lock screen or headphones keep working, songs keep
// advancing through the playlist, and when you come back the app picks up where the audio is.
const BackgroundAudio = (() => {
  const media = Player.media;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.setAttribute('x-webkit-airplay', 'allow');
  let bg = false;          // the app is in the background and <audio> has the sound
  let wanted = false;      // music should be playing
  const origPlay = media.play.bind(media), origPause = media.pause.bind(media);

  const srcOf = () => media.src || media.currentSrc; // src first: currentSrc lags behind a new song
  function seekWhenReady(el, t) {
    if (!(t > 0)) return;
    if (el.readyState >= 1) { try { el.currentTime = t; } catch {} return; }
    el.addEventListener('loadedmetadata', () => { try { el.currentTime = t; } catch {} }, { once: true });
  }
  function syncSession() {
    try { navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'; } catch {}
    try { if (audio.duration && isFinite(audio.duration)) navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 }); } catch {}
  }
  // play whatever the player has loaded, from where it is, on the <audio> element
  function handOver(play = true) {
    const src = srcOf();
    if (!src) return Promise.resolve();
    if (audio.src !== src) { audio.src = src; seekWhenReady(audio, media.currentTime || 0); }
    else if (Math.abs(audio.currentTime - (media.currentTime || 0)) > 1.5) seekWhenReady(audio, media.currentTime || 0);
    audio.playbackRate = media.playbackRate || 1;
    audio.volume = media.volume;
    audio.muted = media.muted;
    if (!play) { audio.pause(); syncSession(); return Promise.resolve(); }
    wanted = true;
    return audio.play().then(syncSession).catch(() => {});
  }

  function enterBackground() {
    if (bg) return;
    const playing = !media.paused || wanted;
    if (!playing || !srcOf()) return;
    bg = true;
    const t = media.currentTime || 0;
    origPause();
    try { media.currentTime = t; } catch {}
    // while in the background, the player's play/pause drive the <audio> element
    media.play = () => handOver(true);
    media.pause = () => { wanted = false; audio.pause(); syncSession(); };
    handOver(true);
  }
  function leaveBackground() {
    if (!bg) return;
    bg = false;
    media.play = origPlay; media.pause = origPause;
    const t = audio.currentTime || 0, keepGoing = !audio.paused;
    const same = audio.src === srcOf();
    audio.pause();
    if (same) seekWhenReady(media, t);
    if (keepGoing) origPlay().catch(() => {});
  }

  // the song on <audio> ended: move on exactly like the player would
  audio.addEventListener('ended', () => { if (bg) { wanted = true; Player.next(true); } });
  audio.addEventListener('play', () => { wanted = true; syncSession(); });
  audio.addEventListener('pause', syncSession);
  audio.addEventListener('timeupdate', () => {
    if (!bg) return;
    // keep the player's clock roughly right (sleep timer, "end" of trimmed songs, resume position)
    const tr = Player.current;
    if (tr && tr.end > 0 && audio.currentTime >= tr.end && tr.end < (audio.duration || Infinity) - 0.5) { Player.next(true); return; }
    if (Math.floor(audio.currentTime) % 5 === 0) syncSession();
  });
  media.addEventListener('play', () => { wanted = true; });
  media.addEventListener('pause', () => { if (!bg && document.visibilityState === 'visible') wanted = false; });
  // iOS sometimes pauses the video a moment before telling the page it's hidden: catch that too
  media.addEventListener('pause', () => { if (!bg && wanted && document.visibilityState !== 'visible') enterBackground(); });

  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? enterBackground() : leaveBackground()));
  window.addEventListener('pagehide', enterBackground);
  window.addEventListener('pageshow', () => { if (document.visibilityState === 'visible') leaveBackground(); });

  // lock screen / headphone controls while the <audio> element has the sound
  if ('mediaSession' in navigator) {
    const h = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch {} };
    h('play', () => (bg ? handOver(true) : media.play()));
    h('pause', () => (bg ? (wanted = false, audio.pause()) : media.pause()));
    h('nexttrack', () => Player.next());
    h('previoustrack', () => { if (bg && audio.currentTime > 3) { audio.currentTime = 0; syncSession(); } else Player.prev(); });
    h('seekto', (d) => { if (d && typeof d.seekTime === 'number') { if (bg) { audio.currentTime = d.seekTime; syncSession(); } else Player.seek(d.seekTime); } });
    h('seekbackward', (d) => { const s = (d && d.seekOffset) || 10; if (bg) audio.currentTime = Math.max(0, audio.currentTime - s); else Player.seek(media.currentTime - s); });
    h('seekforward', (d) => { const s = (d && d.seekOffset) || 10; if (bg) audio.currentTime = audio.currentTime + s; else Player.seek(media.currentTime + s); });
  }

  return { get active() { return bg; }, audio, enterBackground, leaveBackground };
})();
