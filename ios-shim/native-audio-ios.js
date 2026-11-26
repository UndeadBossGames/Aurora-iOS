// Aurora for iPhone: songs play through iOS's own audio engine (AuroraAudioPlugin.swift).
//
// The player (web/js/player.js, shared with the PC app) talks to one <video id="media"> element.
// For songs, this file quietly takes over that element: setting its src, play(), pause(),
// currentTime and so on are passed to the native engine, and the native engine's news comes back
// as the usual media events (play, pause, timeupdate, ended...). Videos still play in the web player.
//
// The native engine also gets the next songs in line, so music keeps going, skips and goes back
// from AirPods / the lock screen even while the app is closed and its web page is asleep.
const NativeAudio = (() => {
  const Cap = window.Capacitor || {};
  const plug = Cap.registerPlugin ? Cap.registerPlugin('AuroraAudio') : (Cap.Plugins || {}).AuroraAudio;
  const el = Player.media;
  if (!plug || !el) return { active: false, available: false };

  const desc = (k) => { for (let o = el; o; o = Object.getPrototypeOf(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (d) return d; } return null; };
  const real = {};
  ['src', 'currentTime', 'duration', 'paused', 'volume', 'muted', 'playbackRate', 'defaultPlaybackRate', 'ended', 'readyState', 'videoWidth', 'videoHeight', 'currentSrc', 'seeking'].forEach((k) => { real[k] = desc(k); });
  const realPlay = HTMLMediaElement.prototype.play, realPause = HTMLMediaElement.prototype.pause, realLoad = HTMLMediaElement.prototype.load;
  const realGetAttr = Element.prototype.getAttribute, realRemoveAttr = Element.prototype.removeAttribute, realHasAttr = Element.prototype.hasAttribute;
  const get = (k) => real[k] && real[k].get ? real[k].get.call(el) : undefined;
  const set = (k, v) => { if (real[k] && real[k].set) real[k].set.call(el, v); };

  const AUDIO = /\.(m4a|mp3|aac|wav|aiff?|caf|flac|alac|m4b)$/i;
  const isAudioUrl = (u) => { try { return AUDIO.test(decodeURIComponent(String(u).split(/[?#]/)[0])); } catch { return AUDIO.test(String(u).split(/[?#]/)[0]); } };

  const S = {
    on: false, src: '', key: '', time: 0, stamp: 0, dur: NaN, paused: true, ended: false, ready: 0,
    rate: 1, volume: 1, muted: false, seeking: false, scrub: false, end: 0,
    pendingLoad: false, startAt: 0, wantPlay: false,
  };
  let adopting = false;
  const fire = (type) => el.dispatchEvent(new Event(type));
  const call = (m, a) => { try { return Promise.resolve(plug[m](a || {})).catch((e) => console.warn('AuroraAudio.' + m, e)); } catch (e) { console.warn(e); return Promise.resolve(); } };

  // the current position, moving smoothly between the native engine's 4-per-second updates
  function nowTime() {
    if (!S.on) return 0;
    let t = S.time;
    if (!S.paused && !S.seeking && S.stamp) t += ((performance.now() - S.stamp) / 1000) * S.rate;
    const lim = S.end > 0 ? S.end - 0.15 : (isFinite(S.dur) ? S.dur : Infinity);
    return Math.max(0, Math.min(t, lim));
  }

  function trackFor(url) {
    const t = Player.current;
    if (t && native.fileUrl(t.path) === url) return t;
    return State.allTracks().find((x) => native.fileUrl(x.path) === url) || null;
  }
  function itemFor(t) {
    return {
      key: t.id, url: native.fileUrl(t.path), title: t.title || '', artist: t.artist && t.artist !== 'Unknown artist' ? t.artist : '',
      album: t.album || '', art: t.cover ? native.fileUrl(t.cover) : (t.coverUrl || ''), end: t.end || 0, duration: t.duration || 0,
      ...((typeof DJ !== 'undefined' && DJ.introFor && DJ.introFor(t.id)) || {}),
    };
  }

  // ---- switching between the native engine (songs) and the web player (videos) ----
  function enter(url) {
    if (S.on && S.src === url && adopting) return;
    if (!S.on) {
      // the web player may still hold a video: silence it
      try { realPause.call(el); } catch {}
      if (realHasAttr.call(el, 'src')) { realRemoveAttr.call(el, 'src'); try { realLoad.call(el); } catch {} }
    }
    const t = trackFor(url);
    Object.assign(S, { on: true, src: url, key: t ? t.id : '', time: 0, stamp: 0, dur: t && t.duration ? t.duration : NaN, paused: true, ended: false, ready: 0, end: t && t.end > 0 ? t.end : 0, startAt: 0, wantPlay: false, pendingLoad: true });
    // Player.load() sets src, then currentTime, then calls play(): gather all three, then load once
    queueMicrotask(flush);
  }
  function flush() {
    if (!S.pendingLoad) return;
    S.pendingLoad = false;
    const t = trackFor(S.src);
    const item = t ? itemFor(t) : { key: S.src, url: S.src, title: '', artist: '', album: '', art: '', end: 0, duration: 0 };
    S.key = item.key;
    S.time = S.startAt; S.stamp = performance.now();
    call('loadItem', { ...item, startAt: S.startAt, play: S.wantPlay });
    sendQueue();
  }
  function leave() {
    if (!S.on) return;
    Object.assign(S, { on: false, src: '', key: '', paused: true, pendingLoad: false });
    call('standDown');
  }

  // the songs after this one, so the native engine can carry on alone (shuffle/queue order included)
  function sendQueue() {
    if (!S.on) return;
    const items = [];
    for (const x of Player.upNext(40)) {
      const t = State.track(x.id);
      if (!t) continue;
      if (!isAudioUrl(native.fileUrl(t.path))) break;   // a video is next: the web player takes it from there
      items.push(itemFor(t));
    }
    call('setQueue', { items, repeatOne: Player.P.repeat === 'one' });
  }
  let qTimer = 0;
  const sendQueueSoon = () => { clearTimeout(qTimer); qTimer = setTimeout(sendQueue, 60); };

  // the native engine moved on by itself (end of song, AirPods double-tap...): catch the player up
  function adopt(key) {
    const P = Player.P;
    const t = State.track(key);
    if (!t || P.current === key) return;
    if (P.userQueue[0] === key) P.userQueue.shift();
    else {
      let i = P.order.findIndex((o, k) => k > P.pos && P.queue[o] === key);
      if (i < 0) i = P.order.findIndex((o) => P.queue[o] === key);
      if (i >= 0) P.pos = i;
    }
    adopting = true;
    S.src = native.fileUrl(t.path);
    S.key = key; S.end = t.end > 0 ? t.end : 0; S.dur = t.duration || NaN;
    S.time = 0; S.stamp = performance.now(); S.ended = false;
    try { Player.load(key, false); } finally { adopting = false; }
    State.countPlay(key);
    State.touchRecent('track', key);
  }

  // ---- the media element, as the rest of the app sees it ----
  const def = (k, getter, setter) => Object.defineProperty(el, k, { configurable: true, enumerable: true, get: getter, set: setter });
  def('src', () => (S.on ? S.src : get('src')), (v) => {
    v = String(v || '');
    if (v && isAudioUrl(v)) { enter(v); return; }
    leave();
    set('src', v);
  });
  def('currentSrc', () => (S.on ? S.src : get('currentSrc')));
  def('currentTime', () => (S.on ? nowTime() : get('currentTime')), (v) => {
    if (!S.on) { set('currentTime', v); return; }
    if (adopting) return;
    v = Math.max(0, Number(v) || 0);
    if (S.pendingLoad) { S.startAt = v; return; }
    S.time = v; S.stamp = performance.now(); S.ended = false;
    S.seeking = true;
    fire('seeking');
    call('seek', { time: v, scrub: S.scrub });
    fire('timeupdate');
  });
  def('duration', () => (S.on ? (S.end > 0 && isFinite(S.dur) ? Math.min(S.dur, S.end) : S.dur) : get('duration')));
  def('paused', () => (S.on ? S.paused : get('paused')));
  def('ended', () => (S.on ? S.ended : get('ended')));
  def('seeking', () => (S.on ? S.seeking : get('seeking')));
  def('readyState', () => (S.on ? S.ready : get('readyState')));
  def('videoWidth', () => (S.on ? 0 : get('videoWidth')));
  def('videoHeight', () => (S.on ? 0 : get('videoHeight')));
  def('volume', () => (S.on ? S.volume : get('volume')), (v) => {
    S.volume = Math.max(0, Math.min(1, Number(v)));
    set('volume', S.volume);
    call('setVolume', { volume: S.muted ? 0 : S.volume });
    fire('volumechange');
  });
  def('muted', () => (S.on ? S.muted : get('muted')), (v) => {
    S.muted = !!v;
    set('muted', S.muted);
    call('setVolume', { volume: S.muted ? 0 : S.volume });
    fire('volumechange');
  });
  def('playbackRate', () => (S.on ? S.rate : get('playbackRate')), (v) => {
    S.rate = Number(v) || 1;
    set('playbackRate', S.rate);
    call('setRate', { rate: S.rate });
    fire('ratechange');
  });
  def('defaultPlaybackRate', () => (S.on ? S.rate : get('defaultPlaybackRate')), (v) => set('defaultPlaybackRate', v));
  el.play = function () {
    if (!S.on) return realPlay.call(el);
    S.wantPlay = true;
    if (S.ended) { S.ended = false; S.time = 0; }
    if (S.paused) { S.paused = false; S.stamp = performance.now(); fire('play'); }
    if (!S.pendingLoad) call('play');
    return Promise.resolve();
  };
  el.pause = function () {
    if (!S.on) return realPause.call(el);
    S.wantPlay = false;
    if (S.pendingLoad) return;
    if (!S.paused) { S.time = nowTime(); S.paused = true; fire('pause'); }
    call('pause');
  };
  el.load = function () { if (!S.on) return realLoad.call(el); };
  el.getAttribute = function (n) { return n === 'src' && S.on ? S.src : realGetAttr.call(el, n); };
  el.hasAttribute = function (n) { return n === 'src' && S.on ? true : realHasAttr.call(el, n); };
  el.removeAttribute = function (n) { if (n === 'src') leave(); return realRemoveAttr.call(el, n); };
  el.fastSeek = function (t) { el.currentTime = t; };

  // ---- news from the native engine ----
  let route = { name: 'This iPhone', kind: 'phone' };
  const routeFns = [];
  call('route').then((r) => { if (r && r.name) route = r; routeFns.forEach((f) => { try { f(route); } catch {} }); });
  plug.addListener('audio', (ev) => {
    if (ev.type === 'route') { route = ev; routeFns.forEach((f) => { try { f(ev); } catch {} }); return; }
    if (!S.on) return;
    switch (ev.type) {
      case 'time':
        if (S.seeking || S.scrub) return;   // don't fight the finger on the progress bar
        S.time = ev.time || 0; S.stamp = performance.now();
        if (ev.duration > 0) S.dur = ev.duration;
        fire('timeupdate');
        break;
      case 'loaded':
        if (ev.key && ev.key !== S.key) return;
        if (ev.duration > 0) S.dur = ev.duration;
        S.ready = 4;
        fire('loadedmetadata'); fire('durationchange'); fire('canplay');
        break;
      case 'state':
        S.time = ev.time != null ? ev.time : S.time; S.stamp = performance.now();
        if (S.paused === !!ev.playing) { S.paused = !ev.playing; fire(S.paused ? 'pause' : 'play'); if (!S.paused) fire('playing'); }
        break;
      case 'seeked':
        S.seeking = false;
        S.time = ev.time != null ? ev.time : S.time; S.stamp = performance.now();
        fire('seeked'); fire('timeupdate');
        break;
      case 'advanced':
        S.advAt = ev.at || Date.now();   // when it really happened (the app may have been asleep)
        adopt(ev.key);
        S.paused = !ev.playing; S.wantPlay = !!ev.playing;
        fire(S.paused ? 'pause' : 'play');
        sendQueueSoon();
        break;
      case 'ended':
        S.ended = true; S.paused = true; S.time = isFinite(S.dur) ? S.dur : S.time;
        fire('pause'); fire('ended');
        break;
      case 'sync':   // back from the background: whatever happened meanwhile
        if (ev.key && ev.key !== S.key) adopt(ev.key);
        S.time = ev.time || 0; S.stamp = performance.now();
        if (ev.duration > 0) S.dur = ev.duration;
        if (S.paused === !!ev.playing) { S.paused = !ev.playing; fire(S.paused ? 'pause' : 'play'); }
        fire('timeupdate');
        sendQueueSoon();
        break;
      case 'remote':
        if (ev.cmd === 'next') Player.next();
        else if (ev.cmd === 'play') Player.toggle();
        break;
      case 'route':
        route = ev; routeFns.forEach((f) => { try { f(ev); } catch {} });
        return;
      case 'error':
        if (ev.key && ev.key !== S.key) return;
        fire('error');
        break;
      default:
    }
  });

  // the queue changed (shuffle, repeat, "play next", a new playlist...): tell the native engine
  Player.on('queue', sendQueueSoon);
  Player.on('mode', sendQueueSoon);
  Player.on('track', sendQueueSoon);

  return {
    available: true,
    get active() { return S.on; },
    // live scrubbing: while the finger is down, seeks are fast and the clock follows the finger
    scrubStart() { S.scrub = true; },
    scrubTo(t) { if (!S.on) return; S.time = t; S.stamp = performance.now(); call('seek', { time: t, scrub: true }); },
    scrubEnd(t) { S.scrub = false; if (S.on) el.currentTime = t; },
    state: S,
    refresh: () => sendQueueSoon(),
    get route() { return route; },
    onRoute(fn) { routeFns.push(fn); },
    pickRoute: () => call('pickRoute'),
  };
})();
