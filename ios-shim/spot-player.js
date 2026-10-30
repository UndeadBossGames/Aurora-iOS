// Aurora for iPhone, standard layout: the mini player above the tab bar and the full-screen
// "Now Playing" view (big artwork or the video, scrubber, controls, AirPlay, share, queue, lyrics,
// about the artist, credits, sleep timer and playback speed).
const SpotPlayer = (() => {
  const body = document.body;
  const { cover } = SpotUI;
  let mini, np, lastId = null, color = '#3a3a3a';
  const fmt = (s) => (isFinite(s) ? fmtTime(s) : '0:00');

  // ---------- AirPlay / output device ----------
  const media = () => Player.media;
  let wireless = false;
  function device() { return wireless ? 'AirPlay' : 'This iPhone'; }
  function pickDevice() {
    const m = media();
    if (m.webkitShowPlaybackTargetPicker) { SpotUI.haptic('light'); m.webkitShowPlaybackTargetPicker(); return; }
    SpotUI.sheet([{ icon: 'phone', label: 'This iPhone', sub: 'Listening on', on: true, action: () => {} }, { icon: 'together', label: 'Listen Together', sub: 'Play in sync with friends anywhere', action: () => App.go('together') }], { title: 'Connect to a device' });
  }

  // ---------- mini player ----------
  function buildMini() {
    mini = html(`<div id="sp-mini" class="sp-mini" hidden>
      <div class="sp-mini-in">
        <div class="sp-mini-art"></div>
        <div class="sp-mini-t"><div class="sp-mini-title"><b></b><span></span></div><small>${icon('devices', 12)}<em></em></small></div>
        <button class="sp-mini-btn sp-mini-dev">${icon('devices', 24)}</button>
        <button class="sp-mini-btn sp-mini-add"></button>
        <button class="sp-mini-btn sp-mini-play"></button>
        <div class="sp-mini-prog"><i></i></div>
      </div>
    </div>`);
    $('#app').appendChild(mini);
    mini.onclick = (e) => {
      if (e.target.closest('.sp-mini-play')) { SpotUI.haptic('light'); return Player.toggle(); }
      if (e.target.closest('.sp-mini-add')) return toggleLike();
      if (e.target.closest('.sp-mini-dev')) return pickDevice();
      open();
    };
    // swipe up = open, swipe sideways = skip
    let s = null;
    mini.addEventListener('touchstart', (e) => { if (!e.target.closest('button')) s = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
    mini.addEventListener('touchend', (e) => {
      if (!s) return;
      const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y; s = null;
      if (dy < -40 && Math.abs(dx) < 60) open();
      else if (Math.abs(dx) > 60 && Math.abs(dy) < 40) { SpotUI.haptic('select'); dx < 0 ? Player.next() : Player.prev(); }
    }, { passive: true });
  }
  function toggleLike() {
    const t = Player.current; if (!t) return;
    const v = State.toggleLike(t.id);
    SpotUI.haptic('medium');
    UI.toast(v ? 'Added to Favorites' : 'Removed from Favorites');
    syncTrack(true);
  }

  // ---------- full-screen player ----------
  function buildNp() {
    np = html(`<div id="sp-np" class="sp-np" aria-hidden="true">
      <div class="sp-np-bg"></div>
      <div class="sp-np-scroll">
        <div class="sp-np-main">
          <div class="sp-np-top"><button class="sp-np-x">${icon('chevronDown', 30)}</button><div class="sp-np-from"><small></small><b></b></div><button class="sp-np-dots">${icon('dotsH', 24)}</button></div>
          <div class="sp-np-art"><div class="sp-np-cover"></div><div class="sp-np-video"></div></div>
          <div class="sp-np-info"><div class="sp-np-names"><b class="sp-np-title"></b><span class="sp-np-artist"></span></div><button class="sp-np-add"></button></div>
          <div class="sp-np-seek"><div class="sp-np-bar"><i class="sp-np-fill"></i><i class="sp-np-knob"></i></div><div class="sp-np-times"><span class="sp-np-cur">0:00</span><span class="sp-np-left">0:00</span></div></div>
          <div class="sp-np-ctrls">
            <button class="sp-np-shuf">${icon('shuffle', 26)}</button>
            <button class="sp-np-prev">${icon('prev', 34)}</button>
            <button class="sp-np-play"></button>
            <button class="sp-np-next">${icon('next', 34)}</button>
            <button class="sp-np-rep"></button>
          </div>
          <div class="sp-np-bottom"><button class="sp-np-dev">${icon('devices', 22)}<span></span></button><span class="sp-flex"></span><button class="sp-np-timer" hidden>${icon('timer', 22)}<em></em></button><button class="sp-np-share">${icon('share', 22)}</button><button class="sp-np-queue">${icon('queue', 24)}</button></div>
        </div>
        <div class="sp-np-cards"></div>
      </div>
    </div>`);
    document.body.appendChild(np);
    $('.sp-np-x', np).onclick = close;
    $('.sp-np-dots', np).onclick = () => moreSheet();
    $('.sp-np-add', np).onclick = toggleLike;
    $('.sp-np-play', np).onclick = () => { SpotUI.haptic('light'); Player.toggle(); };
    $('.sp-np-prev', np).onclick = () => { SpotUI.haptic('select'); Player.prev(); };
    $('.sp-np-next', np).onclick = () => { SpotUI.haptic('select'); Player.next(); };
    $('.sp-np-shuf', np).onclick = () => { SpotUI.haptic('select'); Player.toggleShuffle(); syncModes(); };
    $('.sp-np-rep', np).onclick = () => { SpotUI.haptic('select'); Player.cycleRepeat(); syncModes(); };
    $('.sp-np-dev', np).onclick = pickDevice;
    $('.sp-np-share', np).onclick = () => Player.current && SpotUI.share(Player.current);
    $('.sp-np-queue', np).onclick = openQueue;
    $('.sp-np-timer', np).onclick = timerSheet;
    $('.sp-np-artist', np).onclick = () => { const t = Player.current; if (t && t.artist !== 'Unknown artist') { close(); App.go('collection', 'artist:' + t.artist); } };
    $('.sp-np-title', np).onclick = () => { const t = Player.current; if (t && t.album) { close(); App.go('collection', 'album:' + t.artist + '\u0001' + t.album); } };
    // scrubbing
    const bar = $('.sp-np-bar', np);
    let drag = false;
    const seekTo = (x) => { const r = bar.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (x - r.left) / r.width)); paintTime(f * (media().duration || 0)); return f; };
    bar.addEventListener('touchstart', (e) => { drag = true; np.classList.add('scrubbing'); seekTo(e.touches[0].clientX); }, { passive: true });
    bar.addEventListener('touchmove', (e) => { if (drag) seekTo(e.touches[0].clientX); }, { passive: true });
    bar.addEventListener('touchend', (e) => { if (!drag) return; drag = false; np.classList.remove('scrubbing'); Player.seekRatio(seekTo(e.changedTouches[0].clientX)); }, { passive: true });
    bar.addEventListener('click', (e) => Player.seekRatio(seekTo(e.clientX)));
    np._drag = () => drag;
    // swipe down from the top half to close; swipe the artwork to skip
    const sc = $('.sp-np-scroll', np);
    let s = null;
    np.addEventListener('touchstart', (e) => { if (sc.scrollTop <= 0 && !e.target.closest('.sp-np-bar, .sp-np-cards')) s = { x: e.touches[0].clientX, y: e.touches[0].clientY, art: !!e.target.closest('.sp-np-art') }; }, { passive: true });
    np.addEventListener('touchmove', (e) => { if (!s) return; const dy = e.touches[0].clientY - s.y; if (dy > 0 && Math.abs(e.touches[0].clientX - s.x) < dy) $('.sp-np-main', np).style.transform = `translateY(${dy * 0.6}px)`; }, { passive: true });
    np.addEventListener('touchend', (e) => {
      if (!s) return;
      const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
      $('.sp-np-main', np).style.transform = '';
      if (dy > 120 && Math.abs(dx) < dy) close();
      else if (s.art && Math.abs(dx) > 60 && Math.abs(dy) < 50) { SpotUI.haptic('select'); dx < 0 ? Player.next() : Player.prev(); }
      s = null;
    }, { passive: true });
  }

  function open() {
    if (!Player.current) return;
    syncTrack(true);
    body.classList.add('sp-np-open');
    np.setAttribute('aria-hidden', 'false');
    $('.sp-np-scroll', np).scrollTop = 0;
    placeVideo();
    SpotUI.haptic('light');
  }
  function close() {
    body.classList.remove('sp-np-open');
    np.setAttribute('aria-hidden', 'true');
    closeQueue(); closeLyrics();
    setTimeout(placeVideo, 320);
  }

  // the video plays inside the artwork area while the player is open
  function placeVideo() {
    const t = Player.current, m = media();
    const slot = $('.sp-np-video', np);
    const want = t && t.kind === 'video' && body.classList.contains('sp-np-open');
    np.classList.toggle('is-video', !!(t && t.kind === 'video'));
    if (want && m.parentNode !== slot) slot.appendChild(m);
    else if (!want && m.parentNode === slot) { const host = $('#media-host'); if (host) host.appendChild(m); }
  }

  function contextLabel() {
    const c = Player.P.context;
    if (!c) return ['PLAYING FROM YOUR LIBRARY', ''];
    const k = c.key || '';
    const kind = k.startsWith('pl:') || ['liked', 'downloads', 'videos', 'local'].includes(k) ? 'PLAYLIST' : k.startsWith('artist:') ? 'ARTIST' : k.startsWith('album:') ? 'ALBUM' : k.startsWith('mix:') ? (/Radio$/.test(c.name || '') ? 'RADIO' : 'MIX') : k === 'search' ? 'SEARCH' : '';
    return [kind ? `PLAYING FROM ${kind}` : 'PLAYING FROM', (c.name || '').replace(/^Search: /, '')];
  }

  function syncTrack(force) {
    const t = Player.current;
    mini.hidden = !t;
    body.classList.toggle('sp-has-mini', !!t);
    if (!t) { if (body.classList.contains('sp-np-open')) close(); return; }
    const liked = State.isLiked(t.id);
    const addIc = icon(liked ? 'addedCircle' : 'addCircle', liked ? 26 : 26);
    $('.sp-mini-add', mini).innerHTML = addIc;
    $('.sp-mini-add', mini).classList.toggle('on', liked);
    $('.sp-np-add', np).innerHTML = icon(liked ? 'addedCircle' : 'addCircle', 30);
    $('.sp-np-add', np).classList.toggle('on', liked);
    if (!force && t.id === lastId) return;
    lastId = t.id;
    const src = UI.coverSrc(t);
    $('.sp-mini-art', mini).innerHTML = cover(src, 'sp-mini-cover');
    $('.sp-mini-title b', mini).textContent = t.title;
    $('.sp-mini-title span', mini).textContent = ' • ' + t.artist;
    $('.sp-mini-t em', mini).textContent = device();
    $('.sp-np-cover', np).innerHTML = cover(src, 'sp-np-img');
    $('.sp-np-title', np).textContent = t.title;
    $('.sp-np-artist', np).textContent = t.artist;
    $('.sp-np-dev span', np).textContent = device();
    const [from, name] = contextLabel();
    $('.sp-np-from small', np).textContent = from;
    $('.sp-np-from b', np).textContent = name;
    SpotUI.colorOf(src).then((c) => {
      color = c;
      mini.style.setProperty('--mc', c);
      np.style.setProperty('--npc', c);
    });
    placeVideo();
    renderCards(t);
  }
  function syncState() {
    const p = Player.playing;
    $('.sp-mini-play', mini).innerHTML = icon(p ? 'pause' : 'play', 26);
    $('.sp-np-play', np).innerHTML = icon(p ? 'pause' : 'play', 30);
    np.classList.toggle('paused', !p);
  }
  function syncModes() {
    const P = Player.P;
    $('.sp-np-shuf', np).classList.toggle('on', P.shuffle);
    $('.sp-np-rep', np).innerHTML = icon(P.repeat === 'one' ? 'repeatOne' : 'repeat', 26);
    $('.sp-np-rep', np).classList.toggle('on', P.repeat !== 'off');
  }
  function paintTime(at) {
    const m = media(), d = m.duration || (Player.current && Player.current.duration) || 0;
    const cur = at !== undefined ? at : m.currentTime || 0;
    const f = d ? Math.min(1, cur / d) : 0;
    $('.sp-mini-prog i', mini).style.width = (f * 100) + '%';
    $('.sp-np-fill', np).style.width = (f * 100) + '%';
    $('.sp-np-knob', np).style.left = (f * 100) + '%';
    $('.sp-np-cur', np).textContent = fmt(cur);
    $('.sp-np-left', np).textContent = '-' + fmt(Math.max(0, d - cur));
    if (at === undefined) Lyrics.tick(cur);
  }

  // ---------- the cards under the player ----------
  function renderCards(t) {
    const box = $('.sp-np-cards', np);
    box.innerHTML = '';
    // lyrics
    const ly = html(`<section class="sp-npc sp-lycard" hidden><div class="sp-npc-head"><b>Lyrics preview</b><button class="sp-pill sm sp-ly-full">Show lyrics</button></div><div class="sp-ly-lines"></div></section>`);
    box.appendChild(ly);
    Lyrics.load(t).then((l) => {
      if (Player.current !== t && (!Player.current || Player.current.id !== t.id)) return;
      if (!l || !l.lines.length) { ly.hidden = true; return; }
      ly.hidden = false;
      Lyrics.preview(ly, l);
    });
    $('.sp-ly-full', ly).onclick = () => openLyrics();
    ly.onclick = (e) => { if (!e.target.closest('button')) openLyrics(); };
    // about the artist
    if (t.artist && t.artist !== 'Unknown artist') {
      const ts = State.allTracks().filter((x) => x.artist === t.artist);
      const followed = State.isPinned('artist:' + t.artist);
      const a = html(`<section class="sp-npc sp-about-np"><div class="sp-about-np-img" style="background-image:url('${esc(SpotViews.artistCover(t.artist))}')"><b>About the artist</b></div><div class="sp-about-np-t"><b>${esc(t.artist)}</b><div><span>${SpotUI.plural(ts.length, 'song')} in your library</span><button class="sp-pill sm">${followed ? 'Following' : 'Follow'}</button></div></div></section>`);
      $('.sp-pill', a).onclick = (e) => { e.stopPropagation(); State.togglePin('artist:' + t.artist); e.target.textContent = State.isPinned('artist:' + t.artist) ? 'Following' : 'Follow'; };
      a.onclick = () => { close(); App.go('collection', 'artist:' + t.artist); };
      box.appendChild(a);
    }
    // credits
    const cr = html(`<section class="sp-npc sp-credits"><div class="sp-npc-head"><b>Credits</b><button class="sp-link">Show all</button></div>${creditRows(t).slice(0, 3).map(([k, v]) => `<div class="sp-cr-row"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</section>`);
    $('.sp-link', cr).onclick = () => credits(t);
    box.appendChild(cr);
    // up next
    const up = Player.upNext(5);
    if (up.length) {
      const q = html(`<section class="sp-npc sp-upnext"><div class="sp-npc-head"><b>Up next</b><button class="sp-link">Open queue</button></div></section>`);
      up.forEach((x, i) => { const tt = State.track(x.id); if (!tt) return; const r = html(`<div class="sp-up-row">${cover(UI.coverSrc(tt), 'sp-up-cover')}<div><b>${esc(tt.title)}</b><span>${esc(tt.artist)}</span></div></div>`); r.onclick = () => Player.jumpToUpNext(i); q.appendChild(r); });
      $('.sp-link', q).onclick = openQueue;
      box.appendChild(q);
    }
    // explore
    const more = State.allTracks().filter((x) => x.artist === t.artist && x.id !== t.id).slice(0, 8);
    if (more.length) {
      const ex = html(`<section class="sp-npc-plain"><b class="sp-npc-title">More by ${esc(t.artist)}</b><div class="sp-shelf-row"></div></section>`);
      more.forEach((x) => { const c = html(`<button class="sp-card small">${cover(UI.coverSrc(x), 'sp-card-cover')}<b class="sp-card-title">${esc(x.title)}</b></button>`); c.onclick = () => Player.playContext({ key: 'artist:' + t.artist, name: t.artist }, [x.id, ...more.filter((y) => y !== x).map((y) => y.id)], 0); $('.sp-shelf-row', ex).appendChild(c); });
      box.appendChild(ex);
    }
  }
  function creditRows(t) {
    const ext = String(t.path || '').split('.').pop().toUpperCase();
    return [
      ['Main Artist', t.artist || 'Unknown artist'],
      t.album ? ['Album', t.album] : null,
      ['Source', t.source === 'local' ? 'Your files' : (t.source || 'Web')],
      t.duration ? ['Length', fmtTime(t.duration)] : null,
      ext ? ['File', `${ext}${t.size ? ` • ${(t.size / 1048576).toFixed(1)} MB` : ''}`] : null,
      t.addedAt ? ['Added', fmtDate(t.addedAt)] : null,
      t.url ? ['Link', t.url] : null,
    ].filter(Boolean);
  }
  function credits(t) {
    t = t || Player.current; if (!t) return;
    SpotUI.sheet(creditRows(t).map(([k, v]) => ({ icon: k === 'Link' ? 'link' : k === 'Main Artist' ? 'user' : k === 'Album' ? 'note' : 'credits', label: v, sub: k, action: k === 'Link' ? () => native.shell.openExternal(v) : k === 'Main Artist' ? () => { close(); App.go('collection', 'artist:' + v); } : () => {} })), { title: 'Credits', head: `<div class="sp-sh-track">${cover(UI.coverSrc(t), 'sp-sh-cover')}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div>` });
  }

  // ---------- "…" in the player ----------
  function moreSheet() {
    const t = Player.current; if (!t) return;
    const liked = State.isLiked(t.id);
    SpotUI.sheet([
      { iconHtml: liked ? `<span class="sp-green">${icon('addedCircle', 24)}</span>` : icon('addCircle', 24), label: liked ? 'Remove from Favorites' : 'Add to Favorites', action: toggleLike },
      { icon: 'addCircle', label: 'Add to playlist', action: () => SpotUI.playlistPicker([t.id]) },
      { icon: 'queue', label: 'Add to queue', action: () => { Player.addToQueue([t.id]); UI.toast('Added to queue'); } },
      { icon: 'radio', label: 'Go to radio', action: () => SpotViews.playRadio(t.artist, t.id) },
      t.artist !== 'Unknown artist' ? { icon: 'user', label: 'Go to artist', action: () => { close(); App.go('collection', 'artist:' + t.artist); } } : null,
      { icon: 'lyrics', label: 'Lyrics', action: openLyrics },
      { icon: 'timer', label: Timer.label() ? `Sleep timer (${Timer.label()})` : 'Sleep timer', action: timerSheet },
      { icon: 'speed', label: `Playback speed (${media().playbackRate || 1}×)`, action: speedSheet },
      { icon: 'devices', label: 'Connect to a device', action: pickDevice },
      { icon: 'share', label: 'Share', action: () => SpotUI.share(t) },
      { icon: 'credits', label: 'View song credits', action: () => credits(t) },
      { icon: 'edit', label: 'Edit details', action: () => UI.editTrackModal(t) },
    ], { head: `<div class="sp-sh-track">${cover(UI.coverSrc(t), 'sp-sh-cover')}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div>` });
  }
  function speedSheet() {
    const cur = media().playbackRate || 1;
    SpotUI.sheet([0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ icon: 'speed', label: `${r}×${r === 1 ? ' (normal)' : ''}`, on: cur === r, action: () => { media().playbackRate = r; media().defaultPlaybackRate = r; UI.toast(`Playback speed ${r}×`); } })), { title: 'Playback speed' });
  }

  // ---------- sleep timer ----------
  const Timer = (() => {
    let until = 0, endOfTrack = false, tick = null;
    function set(min) {
      clearInterval(tick); endOfTrack = false; until = 0;
      if (min === 'track') { endOfTrack = true; UI.toast('Sleep timer: end of this song'); }
      else if (min) { until = Date.now() + min * 60000; UI.toast(`Sleep timer set for ${min >= 60 ? min / 60 + ' hour' + (min > 60 ? 's' : '') : min + ' minutes'}`); }
      else UI.toast('Sleep timer off');
      if (min) tick = setInterval(check, 1000);
      sync();
    }
    function check() { if (until && Date.now() >= until) { Player.media.pause(); set(0); UI.toast('Sleep timer: playback paused'); } sync(); }
    function onEnded() { if (endOfTrack) { setTimeout(() => Player.media.pause(), 50); set(0); } }
    function label() {
      if (endOfTrack) return 'end of song';
      if (!until) return '';
      const s = Math.max(0, Math.round((until - Date.now()) / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    function sync() { const b = $('.sp-np-timer', np); if (!b) return; const l = label(); b.hidden = !l; $('em', b).textContent = l; }
    return { set, label, onEnded, get on() { return !!(until || endOfTrack); } };
  })();
  function timerSheet() {
    const opts = [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], ['track', 'End of song']];
    SpotUI.sheet([
      ...opts.map(([v, l]) => ({ icon: 'timer', label: l, action: () => Timer.set(v) })),
      Timer.on ? { icon: 'close', label: 'Turn off timer', action: () => Timer.set(0) } : null,
    ], { title: 'Sleep timer' });
  }

  // ---------- queue ----------
  let qEl = null;
  function openQueue() {
    closeQueue();
    qEl = html(`<div class="sp-queue"><div class="sp-q-top"><button class="sp-np-x">${icon('chevronDown', 30)}</button><b>Queue</b><span></span></div><div class="sp-q-list"></div><div class="sp-q-bar"><button class="sp-q-shuf">${icon('shuffle', 22)}<span>Shuffle</span></button><button class="sp-q-rep">${icon('repeat', 22)}<span>Repeat</span></button><button class="sp-q-timer">${icon('timer', 22)}<span>Timer</span></button></div></div>`);
    np.appendChild(qEl);
    $('.sp-np-x', qEl).onclick = closeQueue;
    $('.sp-q-shuf', qEl).onclick = () => { Player.toggleShuffle(); drawQueue(); syncModes(); };
    $('.sp-q-rep', qEl).onclick = () => { Player.cycleRepeat(); drawQueue(); syncModes(); };
    $('.sp-q-timer', qEl).onclick = timerSheet;
    drawQueue();
    requestAnimationFrame(() => qEl && qEl.classList.add('open'));
  }
  function closeQueue() { if (qEl) { const el = qEl; qEl = null; el.classList.remove('open'); setTimeout(() => el.remove(), 250); } }
  function drawQueue() {
    if (!qEl) return;
    const list = $('.sp-q-list', qEl);
    const t = Player.current;
    $('.sp-q-shuf', qEl).classList.toggle('on', Player.P.shuffle);
    $('.sp-q-rep', qEl).classList.toggle('on', Player.P.repeat !== 'off');
    list.innerHTML = '';
    if (t) { list.appendChild(html('<h3>Now playing</h3>')); list.appendChild(SpotViews.row(t, { dots: false, play: () => {} })); }
    const up = Player.upNext(80);
    const user = up.filter((x) => x.user), ctx = up.filter((x) => !x.user);
    if (user.length) {
      const h = html('<div class="sp-q-h"><h3>Next in queue</h3><button class="sp-link">Clear queue</button></div>');
      $('button', h).onclick = () => { Player.P.userQueue.length = 0; drawQueue(); };
      list.appendChild(h);
      user.forEach((x, i) => { const tt = State.track(x.id); const r = SpotViews.row(tt, { dots: false, remove: () => { Player.P.userQueue.splice(i, 1); drawQueue(); }, play: () => Player.jumpToUpNext(i) }); list.appendChild(r); });
    }
    if (ctx.length) {
      list.appendChild(html(`<h3>Next from: ${esc((Player.P.context && Player.P.context.name) || 'your library')}</h3>`));
      ctx.forEach((x, j) => { const tt = State.track(x.id); list.appendChild(SpotViews.row(tt, { dots: false, play: () => Player.jumpToUpNext(user.length + j) })); });
    }
    if (!user.length && !ctx.length) list.appendChild(html('<div class="sp-noresults small"><span>Nothing up next. Swipe right on any song to add it to the queue.</span></div>'));
  }

  // ---------- lyrics (from lrclib.net, a free lyrics database; saved for offline) ----------
  const Lyrics = (() => {
    const mem = new Map();
    let cur = null, lastIdx = -1;
    const keyOf = (t) => 'lyrics-' + String(t.id).replace(/[^a-z0-9]/gi, '').slice(0, 40);
    const clean = (s) => String(s || '').replace(/\s*[([](official|lyric|music|audio|video|hd|4k|visualizer|explicit)[^)\]]*[)\]]/gi, '').replace(/\s*-\s*topic$/i, '').replace(/\s+(ft\.?|feat\.?)\s.*$/i, '').trim();
    function parse(data) {
      if (!data) return null;
      if (data.syncedLyrics) {
        const lines = [];
        for (const ln of data.syncedLyrics.split('\n')) {
          const m = ln.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/);
          if (m) lines.push({ t: +m[1] * 60 + +m[2], s: m[3] });
        }
        if (lines.length) return { synced: true, lines };
      }
      if (data.plainLyrics) return { synced: false, lines: data.plainLyrics.split('\n').map((s) => ({ t: -1, s })) };
      return null;
    }
    async function load(t) {
      if (mem.has(t.id)) return (cur = mem.get(t.id));
      cur = null; lastIdx = -1;
      let data = null;
      try { data = await native.store.read(keyOf(t), null); } catch {}
      if (!data && navigator.onLine !== false) {
        const title = clean(t.title.replace(new RegExp('^' + t.artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–]\\s*', 'i'), ''));
        const artist = clean(t.artist);
        try {
          let r = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}${t.duration ? `&duration=${Math.round(t.duration)}` : ''}`);
          if (r.ok) data = await r.json();
          if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
            r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(artist + ' ' + title)}`);
            if (r.ok) { const list = await r.json(); data = (list || []).find((x) => x.syncedLyrics) || (list || [])[0] || null; }
          }
          if (data) native.store.write(keyOf(t), { syncedLyrics: data.syncedLyrics || null, plainLyrics: data.plainLyrics || null, instrumental: !!data.instrumental });
        } catch {}
      }
      const l = parse(data) || { lines: [] };
      mem.set(t.id, l);
      cur = l;
      return l;
    }
    function index(time) {
      if (!cur || !cur.synced) return -1;
      let i = -1;
      for (let k = 0; k < cur.lines.length; k++) { if (cur.lines[k].t <= time + 0.25) i = k; else break; }
      return i;
    }
    function preview(card, l) {
      const box = $('.sp-ly-lines', card);
      box.innerHTML = l.lines.slice(0, 40).map((x, i) => `<p data-i="${i}">${esc(x.s || '♪')}</p>`).join('');
      card.style.setProperty('--lc', color);
      lastIdx = -2;
      tick(media().currentTime || 0);
    }
    function tick(time) {
      if (!cur || !cur.synced) return;
      const i = index(time);
      if (i === lastIdx) return;
      lastIdx = i;
      for (const box of $$('.sp-ly-lines, .sp-lyrics-body')) {
        $$('p', box).forEach((p) => { const k = +p.dataset.i; p.classList.toggle('on', k === i); p.classList.toggle('past', k < i); });
        const on = $(`p[data-i="${i}"]`, box);
        if (on) box.scrollTo({ top: on.offsetTop - box.clientHeight * (box.classList.contains('sp-lyrics-body') ? 0.35 : 0.3), behavior: 'smooth' });
      }
    }
    return { load, tick, preview, get current() { return cur; } };
  })();
  let lyEl = null;
  async function openLyrics() {
    const t = Player.current; if (!t) return;
    closeLyrics();
    lyEl = html(`<div class="sp-lyrics" style="--lc:${color}"><div class="sp-q-top"><button class="sp-np-x">${icon('chevronDown', 30)}</button><div class="sp-np-from"><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></div><span></span></div><div class="sp-lyrics-body"><p class="sp-ly-wait">Finding lyrics…</p></div><div class="sp-ly-ctrls"><button class="sp-np-play">${icon(Player.playing ? 'pause' : 'play', 28)}</button></div></div>`);
    np.appendChild(lyEl);
    $('.sp-np-x', lyEl).onclick = closeLyrics;
    $('.sp-ly-ctrls .sp-np-play', lyEl).onclick = () => Player.toggle();
    requestAnimationFrame(() => lyEl && lyEl.classList.add('open'));
    const l = await Lyrics.load(t);
    if (!lyEl) return;
    const bodyEl = $('.sp-lyrics-body', lyEl);
    if (!l.lines.length) { bodyEl.innerHTML = `<p class="sp-ly-wait">Lyrics aren't available for this song.</p>`; return; }
    bodyEl.innerHTML = l.lines.map((x, i) => `<p data-i="${i}">${esc(x.s || '♪')}</p>`).join('') + (l.synced ? '' : '<small class="sp-ly-note">These lyrics aren\'t synced to the song.</small>');
    bodyEl.onclick = (e) => { const p = e.target.closest('p[data-i]'); if (p && l.synced) { const x = l.lines[+p.dataset.i]; if (x && x.t >= 0) Player.seek(x.t); } };
    Lyrics.tick(media().currentTime || 0);
  }
  function closeLyrics() { if (lyEl) { const el = lyEl; lyEl = null; el.classList.remove('open'); setTimeout(() => el.remove(), 250); } }

  function setup() {
    buildMini();
    buildNp();
    const m = media();
    m.setAttribute('x-webkit-airplay', 'allow');
    m.setAttribute('playsinline', '');
    m.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => { wireless = !!m.webkitCurrentPlaybackTargetIsWireless; syncTrack(true); });
    m.addEventListener('ended', () => Timer.onEnded());
    m.addEventListener('ratechange', () => { if (m.playbackRate !== m.defaultPlaybackRate && m.defaultPlaybackRate !== 1) m.playbackRate = m.defaultPlaybackRate; });
    Player.on('track', () => { syncTrack(false); syncState(); paintTime(); });
    Player.on('state', () => { syncState(); syncTrack(false); if (lyEl) $('.sp-ly-ctrls .sp-np-play', lyEl).innerHTML = icon(Player.playing ? 'pause' : 'play', 28); });
    Player.on('time', () => { if (!np._drag()) paintTime(); });
    Player.on('meta', () => paintTime());
    Player.on('queue', () => { drawQueue(); if (Player.current) renderCards(Player.current); });
    Player.on('mode', syncModes);
    State.on('likes', () => syncTrack(false));
    syncTrack(true); syncState(); syncModes(); paintTime();
    // the classic layer keeps moving the video back; put it where it belongs after any re-render
    new MutationObserver(() => { if (body.classList.contains('sp-np-open') && Player.current && Player.current.kind === 'video' && media().parentNode !== $('.sp-np-video', np)) placeVideo(); }).observe($('#media-host') || document.body, { childList: true });
  }

  return { setup, open, close, credits, openQueue, openLyrics, timer: Timer };
})();
