// Aurora for iPhone: the "standard" phone layout (modelled on the big streaming apps' iPhone design).
// Its own tab bar (Home, Search, Your Library, Store, Create), a side menu behind your avatar,
// bottom sheets instead of pop-up menus, and per-page headers instead of the desktop top bar.
// The views live in spot-views.js and the player in spot-player.js. Settings → Appearance →
// "iPhone layout" switches back to the classic Aurora layout.
const SpotUI = (() => {
  const body = document.body;
  const S = { active: false, drawer: false };
  const haptic = (s = 'light') => { try { native.haptic && native.haptic(s); } catch {} };

  // ---------- extra icons ----------
  Object.assign(ICONS, {
    homeOutline: '<path d="M12 3.2 3.5 9.6V21h6.2v-6.3h4.6V21h6.2V9.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    homeSolid: '<path d="M12 2.6 2.8 9.5V21.8h7.4v-6.3h3.6v6.3h7.4V9.5z"/>',
    searchSolid: '<circle cx="10.5" cy="10.5" r="7" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="m16 16 5.5 5.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    libOutline: '<path d="M4 3.5v17M9 3.5v17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m13.2 4.1 6.4 16.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    libSolid: '<rect x="2.8" y="3" width="3" height="18" rx="1"/><rect x="7.8" y="3" width="3" height="18" rx="1"/><path d="m12.4 4.6 2.8-1.1 6.6 16.6-2.8 1.1z"/>',
    plusBig: '<path d="M12 3.5v17M3.5 12h17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H4.5v10h15V11H18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    devices: '<path d="M5 13a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="3" y="12.5" width="4.5" height="8" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="16.5" y="12.5" width="4.5" height="8" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    camera: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h3l1.6-2.2h5.8L16.5 7h3A1.5 1.5 0 0 1 21 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    stats: '<path d="M3.5 20.5V3.5M3.5 20.5h17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m6.5 15.5 4-5 3.5 3 6-7.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    history: '<path d="M4.2 12a7.8 7.8 0 1 0 2.3-5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3.5 3.8v4h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.5v4.8l3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    megaphone: '<path d="M4 9.5h3.5L17 4.5v15l-9.5-5H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7.5 14.5 9 20h2.5l-1-5M20 9.5v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5l1.6 2.3 2.7-.7.7 2.7 2.6 1-.6 2.7 2 1.9-2 1.9.6 2.7-2.6 1-.7 2.7-2.7-.7L12 21.5l-1.6-2.3-2.7.7-.7-2.7-2.6-1 .6-2.7-2-1.9 2-1.9-.6-2.7 2.6-1 .7-2.7 2.7.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    sortArrows: '<path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    listLines: '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    lyrics: '<path d="M4 5h11M4 10h11M4 15h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16.5" cy="17.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19 17.5V9l2 1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    airplay: '<path d="M6.5 17.5H4.5a1.5 1.5 0 0 1-1.5-1.5V5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5V16a1.5 1.5 0 0 1-1.5 1.5h-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 14.5 17 20.5H7z"/>',
    dl: '<circle cx="12" cy="12" r="10"/><path d="M12 6.5v9m0 0-3.6-3.6M12 15.5l3.6-3.6" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    dlOutline: '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v9.5m0 0-3.6-3.6M12 16.5l3.6-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    addCircle: '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    addedCircle: '<circle cx="12" cy="12" r="10"/><path d="m7.3 12.3 3.2 3.2 6.2-6.6" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    userPlus: '<circle cx="10" cy="8" r="3.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 20c.7-3.5 3.5-5.5 7-5.5 1.4 0 2.7.3 3.8.9M18.5 13v7M15 16.5h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    note: '<path d="M9 18V5.5l11-2V16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17.5" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    together: '<circle cx="8" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M2.5 19c.5-3 2.7-4.7 5.5-4.7s5 1.7 5.5 4.7M12.5 15.3c1-.7 2.4-1 4-1 2.8 0 5 1.7 5.5 4.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    folderPlus: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10.5v6M9 13.5h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    chat: '<path d="M4 5.5h16v10.5H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    compose: '<path d="M14 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m9.5 14.5.5-3L18.5 3l2.5 2.5-8.5 8.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    explicit: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9.5 7.5h5M9.5 12h4.5M9.5 16.5h5M9.5 7.5v9" stroke="#121212" stroke-width="2" stroke-linecap="round"/>',
    arrowUpLeft: '<path d="M17.5 17.5 6.5 6.5M6.5 14V6.5H14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    speed: '<path d="M4 15a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m12 15 4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    radio: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    credits: '<rect x="4" y="3.5" width="16" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    reshuffle: '<path d="M3 6.5h3.2c2 0 3.2 1 4.3 2.7l3 5.6c1 1.7 2.3 2.7 4.3 2.7H21M3 17.5h3.2c1.5 0 2.5-.6 3.4-1.6M14.4 8.1c.9-1 1.9-1.6 3.4-1.6H21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m18.5 3.8 2.7 2.7-2.7 2.7M18.5 14.8l2.7 2.7-2.7 2.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="20.5" r="1.3"/>',
  });

  // ---------- small helpers ----------
  const cover = (src, cls = '', round = false) => UI.coverHtml(src, cls, round);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const me = () => State.activeProfile() || { name: 'You', color: '#8b7bff' };
  const avatar = (size = 32) => UI.avatarHtml(me(), size);
  const trackCover = (t) => UI.coverSrc(t);
  const isVideo = (t) => t && t.kind === 'video';

  // dominant colour of a picture (cached), for headers, the mini player and the full-screen player
  const colorCache = new Map();
  function colorOf(src, fallback = '#535353') {
    if (!src || typeof src !== 'string') return Promise.resolve(fallback);
    if (colorCache.has(src)) return Promise.resolve(colorCache.get(src));
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 24;
          const g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
          const d = g.getImageData(0, 0, 24, 24).data;
          let r = 0, gg = 0, b = 0, w = 0;
          for (let i = 0; i < d.length; i += 4) {
            const R = d[i], G = d[i + 1], B = d[i + 2];
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            const sat = mx ? (mx - mn) / mx : 0;
            const wt = 0.2 + sat * 2 + (mx > 40 && mx < 235 ? 0.5 : 0); // prefer colourful, mid-bright pixels
            r += R * wt; gg += G * wt; b += B * wt; w += wt;
          }
          r /= w; gg /= w; b /= w;
          // keep it dark enough for white text, but still clearly coloured
          const l = (Math.max(r, gg, b) + Math.min(r, gg, b)) / 2;
          const k = l > 120 ? 120 / l : l < 60 ? 70 / Math.max(l, 1) : 1;
          const out = `rgb(${Math.round(Math.min(255, r * k))}, ${Math.round(Math.min(255, gg * k))}, ${Math.round(Math.min(255, b * k))})`;
          colorCache.set(src, out);
          resolve(out);
        } catch { resolve(fallback); }
      };
      img.onerror = () => resolve(fallback);
      img.src = src;
    });
  }
  const firstSrc = (c) => (c && typeof c === 'object' && c.mosaic ? c.mosaic[0] : c);

  // ---------- bottom sheets (menus, create, pickers) ----------
  let sheetEl = null;
  function closeSheet() {
    if (!sheetEl) return;
    const el = sheetEl; sheetEl = null;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 260);
    body.classList.remove('sp-sheet-open');
  }
  // items: [{ icon, label, sub, action, danger, on, html }] ; opts: { head (html), title, cls, closeBtn }
  function sheet(items, opts = {}) {
    closeSheet();
    UI.closeMenu && UI.closeMenu();
    const el = html(`<div class="sp-sheet ${opts.cls || ''}">
      <div class="sp-sheet-dim"></div>
      <div class="sp-sheet-card">
        <div class="sp-sheet-grip"></div>
        ${opts.head ? `<div class="sp-sheet-head">${opts.head}</div>` : ''}
        ${opts.title ? `<div class="sp-sheet-title">${esc(opts.title)}</div>` : ''}
        <div class="sp-sheet-items"></div>
      </div>
      ${opts.closeBtn ? `<button class="sp-sheet-x">${icon('close', 26)}</button>` : ''}
    </div>`);
    const list = $('.sp-sheet-items', el);
    for (const it of items.filter(Boolean)) {
      if (it.divider) { list.appendChild(html('<div class="sp-sheet-div"></div>')); continue; }
      const row = html(`<button class="sp-sheet-item ${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''} ${it.sub ? 'two' : ''}">
        <span class="sp-si-ic ${it.round ? 'round' : ''}">${it.iconHtml || icon(it.icon || 'dots', it.round ? 22 : 24)}</span>
        <span class="sp-si-text"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
        ${it.on ? `<span class="sp-si-on">${icon('check', 18)}</span>` : ''}
      </button>`);
      row.onclick = () => { haptic('select'); if (!it.keepOpen) closeSheet(); setTimeout(() => it.action && it.action(), it.keepOpen ? 0 : 120); };
      list.appendChild(row);
    }
    $('.sp-sheet-dim', el).onclick = closeSheet;
    if ($('.sp-sheet-x', el)) $('.sp-sheet-x', el).onclick = closeSheet;
    // drag the card down to close
    const card = $('.sp-sheet-card', el);
    let y0 = null, dy = 0;
    card.addEventListener('touchstart', (e) => { if (card.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
    card.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); card.style.transform = `translateY(${dy}px)`; }, { passive: true });
    card.addEventListener('touchend', () => { if (y0 === null) return; card.style.transform = ''; if (dy > 110) closeSheet(); y0 = null; }, { passive: true });
    document.body.appendChild(el);
    sheetEl = el;
    body.classList.add('sp-sheet-open');
    requestAnimationFrame(() => el.classList.add('open'));
    return el;
  }

  // the song menu (long press or "…" on any song)
  function trackSheet(t, ctx = {}) {
    if (!t) return;
    haptic('medium');
    const liked = State.isLiked(t.id);
    const album = t.album && !/^(Downloads|Spotify downloads|Youtube|Soundcloud|Generic)$/i.test(t.album) ? t.album : null;
    sheet([
      { icon: 'addCircle', label: 'Add to playlist', action: () => playlistPicker([t.id]) },
      { iconHtml: liked ? `<span class="sp-green">${icon('addedCircle', 24)}</span>` : icon('addCircle', 24), label: liked ? 'Remove from Favorites' : 'Add to Favorites', action: () => { const v = State.toggleLike(t.id); UI.toast(v ? 'Added to Favorites' : 'Removed from Favorites'); } },
      ctx.playlistId ? { icon: 'trash', label: 'Remove from this playlist', action: () => State.removeFromPlaylist(ctx.playlistId, t.id) } : null,
      { icon: 'queue', label: 'Add to queue', action: () => { Player.addToQueue([t.id]); UI.toast('Added to queue'); } },
      { icon: 'radio', label: 'Go to song radio', action: () => SpotViews.playRadio(t.artist, t.id) },
      t.artist && t.artist !== 'Unknown artist' ? { icon: 'user', label: 'Go to artist', action: () => App.go('collection', 'artist:' + t.artist) } : null,
      album ? { icon: 'note', label: 'Go to album', action: () => App.go('collection', 'album:' + t.artist + '\u0001' + album) } : null,
      { icon: 'share', label: 'Share', action: () => share(t) },
      { icon: 'credits', label: 'View song credits', action: () => SpotPlayer.credits(t) },
      { icon: 'edit', label: 'Edit details', action: () => UI.editTrackModal(t) },
      State.profiles().length > 1 ? { icon: 'transfer', label: 'Send to another profile', action: () => Views.transfer.open([t.id]) } : null,
      { icon: 'close', label: 'Remove from library', action: () => { State.removeTracks([t.id]); UI.toast('Removed from library'); } },
      { icon: 'trash', label: 'Delete from this iPhone', danger: true, action: async () => {
        if (!(await native.dialog.confirm({ message: `Delete "${t.title}"?`, detail: 'The file is removed from your iPhone.', ok: 'Delete' }))) return;
        await native.library.deleteFile(t.path); State.removeTracks([t.id]); UI.toast('Deleted');
      } },
    ], { head: `<div class="sp-sh-track">${cover(trackCover(t), 'sp-sh-cover')}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}${album ? ' • ' + esc(album) : ''}</span></div></div>` });
  }

  function playlistPicker(ids) {
    const pls = State.playlists();
    sheet([
      { icon: 'plus', label: 'New playlist', round: true, action: () => { const pl = State.createPlaylist({ trackIds: ids }); UI.toast(`Added to ${pl.name}`); } },
      ...pls.map((p) => ({ iconHtml: cover(State.playlistCover(p), 'sp-si-cover'), label: p.name, sub: plural(p.items.length, 'song'), action: () => { const n = State.addToPlaylist(p.id, ids); UI.toast(n ? `Added to ${p.name}` : `Already in ${p.name}`); } })),
    ], { title: 'Add to playlist', cls: 'tall' });
  }

  async function share(t) {
    const text = t.url ? `${t.title} by ${t.artist}\n${t.url}` : `${t.title} by ${t.artist} (on Aurora)`;
    try {
      if (navigator.share) { await navigator.share({ title: t.title, text, url: t.url || undefined }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); UI.toast('Copied to clipboard'); } catch { UI.toast(text, 5000); }
  }

  // ---------- Create (+ tab) ----------
  function createSheet() {
    haptic('light');
    sheet([
      { icon: 'note', round: true, label: 'Playlist', sub: 'Create a playlist with songs or videos', action: () => App.newPlaylist() },
      { icon: 'together', round: true, label: 'Listen Together', sub: 'Listen together from anywhere', action: () => App.go('together') },
      { icon: 'download', round: true, label: 'Download', sub: 'Save a song or video from a link', action: () => App.go('downloader') },
      { icon: 'folderPlus', round: true, label: 'Add from Files', sub: 'Import music and videos from your iPhone', action: () => App.importFiles() },
    ], { cls: 'create', closeBtn: true });
  }

  // ---------- side menu (tap your avatar) ----------
  function openDrawer() {
    closeSheet();
    let d = $('#sp-drawer');
    if (!d) { d = html('<aside id="sp-drawer" class="sp-drawer"></aside>'); document.body.appendChild(d); }
    const p = me();
    const friends = Friends.friends();
    const fr = friends.slice(0, 12).map((f) => {
      const s = Friends.statusOf(f.code);
      const name = f.nickname || s.name || f.code;
      const on = s.status && !['offline', 'unknown'].includes(s.status);
      const now = s.track ? `${s.track.title}` : on ? 'Online' : 'Offline';
      return `<button class="sp-dr-friend" data-code="${esc(f.code)}"><span class="sp-dr-fav" style="background:${esc(s.color || colorFor(name))}">${s.avatar ? `<img src="${esc(s.avatar)}" />` : esc(name[0] || '?')}${on ? '<i></i>' : ''}</span><b>${esc(name)}</b><small>${esc(now)}</small></button>`;
    }).join('');
    const upd = (typeof Updates !== 'undefined' && Updates.state && ['available', 'ready'].includes(Updates.state.phase));
    d.innerHTML = `
      <div class="sp-dr-scroll">
        <div class="sp-dr-card">
          <button class="sp-dr-me">${avatar(52)}<div><b>${esc(p.name)}</b><span>View profile</span></div></button>
          <button class="sp-dr-add"><span class="sp-dr-plus">${icon('plus', 20)}</span><div><b>Add profile</b><span>Add a profile for someone else</span></div></button>
        </div>
        <button class="sp-dr-item" data-a="stats">${icon('stats', 24)}<span>Listening stats</span></button>
        <button class="sp-dr-item" data-a="recents">${icon('history', 24)}<span>Recents</span></button>
        <button class="sp-dr-item" data-a="updates">${icon('megaphone', 24)}<span>Your Updates</span>${upd ? '<i class="sp-dot"></i>' : ''}</button>
        <button class="sp-dr-item" data-a="account">${icon('cloud', 24)}<span>Aurora Account</span>${typeof Account !== 'undefined' && Account.signedIn() ? '<em>Synced</em>' : ''}</button>
        <button class="sp-dr-item" data-a="settings">${icon('gear', 24)}<span>Settings and privacy</span></button>
        <div class="sp-dr-friends">
          <button class="sp-dr-friend act" data-a="friends"><span class="sp-dr-fav me">${avatar(56)}</span><b>Activity</b><small>${Friends.sharing() ? 'On' : 'Turn on'}</small></button>
          ${fr}
          <button class="sp-dr-friend" data-a="addfriend"><span class="sp-dr-fav add">${icon('plus', 26)}</span><b>Invite friends</b><small>&nbsp;</small></button>
        </div>
        <button class="sp-dr-msg" data-a="friends"><div><b>Friends ${icon('chevronRight', 18)}</b><span>See what your friends are playing and share your music with them.</span></div><span class="sp-dr-compose">${icon('compose', 24)}</span></button>
        <button class="sp-dr-new" data-a="together"><span class="sp-dr-plus">${icon('together', 22)}</span><span>Start a Listen Together session</span></button>
      </div>`;
    const go = (fn) => { closeDrawer(); setTimeout(fn, 180); };
    $('.sp-dr-me', d).onclick = () => go(() => App.go('profile'));
    $('.sp-dr-add', d).onclick = () => go(() => App.showProfilePicker());
    $$('[data-a]', d).forEach((b) => b.onclick = () => go(() => ({
      stats: () => App.go('spstats'), recents: () => App.go('sprecents'), updates: () => SpotViews.updates(),
      account: () => App.go('account'), settings: () => App.go('settings'), friends: () => App.go('friends'),
      addfriend: () => App.go('friends'), together: () => App.go('together'),
    })[b.dataset.a]()));
    $$('.sp-dr-friend[data-code]', d).forEach((b) => b.onclick = () => go(() => App.go('friendlib', b.dataset.code)));
    S.drawer = true;
    body.classList.add('sp-drawer-open');
    haptic('light');
  }
  function closeDrawer() { S.drawer = false; body.classList.remove('sp-drawer-open'); }

  // ---------- tab bar ----------
  const ROOT_VIEWS = ['home', 'search', 'yourlib', 'store'];
  const TABS = [
    ['home', 'homeOutline', 'homeSolid', 'Home'],
    ['search', 'search', 'searchSolid', 'Search'],
    ['yourlib', 'libOutline', 'libSolid', 'Your Library'],
    ['store', 'bag', 'bag', 'Store'],
    ['create', 'plusBig', 'plusBig', 'Create'],
  ];
  let lastTab = 'home';
  function tabOf(view) {
    if (['home', 'search', 'yourlib', 'store'].includes(view)) return view;
    if (['discover'].includes(view)) return 'search';
    if (['collection', 'spstats', 'sprecents'].includes(view)) return lastTab;
    return lastTab;
  }
  function renderTabs() {
    let bar = $('#sp-tabs');
    if (!bar) { bar = html('<nav id="sp-tabs" class="sp-tabs"></nav>'); $('#app').appendChild(bar); }
    const cur = tabOf(App.current && App.current.view);
    lastTab = cur === 'create' ? lastTab : cur;
    bar.innerHTML = TABS.map(([t, ic, icOn, label]) => `<button class="sp-tab ${t === cur ? 'on' : ''}" data-t="${t}">${icon(t === cur ? icOn : ic, 26)}<span>${label}</span></button>`).join('');
    $$('.sp-tab', bar).forEach((b) => b.onclick = () => {
      const t = b.dataset.t;
      haptic('select');
      if (t === 'create') return createSheet();
      if (App.current && App.current.view === t) { $('#main-scroll').scrollTo({ top: 0, behavior: 'smooth' }); if (t === 'search') SpotViews.focusSearch(); return; }
      App.go(t);
    });
  }

  // a back button on every page that isn't a tab's first page
  function renderBack() {
    let b = $('#sp-back');
    if (!b) {
      b = html(`<button id="sp-back" class="sp-back">${icon('chevronLeft', 26)}</button>`);
      b.onclick = () => { haptic('select'); App.back(); };
      $('#main').appendChild(b);
    }
    const v = App.current && App.current.view;
    b.hidden = !v || ROOT_VIEWS.includes(v);
    body.classList.toggle('sp-has-back', !b.hidden);
    body.dataset.spView = v || '';
  }

  // ---------- turn it on ----------
  function setup() {
    S.active = true;
    body.classList.add('spot');
    SpotViews.install();
    // the classic layer's tab bar, Library sheet and top bar are replaced
    body.classList.remove('show-lib');
    const go = App.go;
    App.go = (view, ...rest) => {
      closeSheet(); closeDrawer();
      if (view === 'library') view = 'yourlib';
      if (view === 'profile' && rest[0] && rest[0] !== State.S.profiles.activeId) { /* other profiles: classic page */ }
      const r = go(view, ...rest);
      renderTabs(); renderBack();
      return r;
    };
    const back = App.back;
    App.back = () => { closeSheet(); closeDrawer(); back(); renderTabs(); renderBack(); };
    // song menus become bottom sheets
    UI.trackMenu = (t, _x, _y, ctx) => trackSheet(t, ctx || {});
    // swipe from the left edge on a tab's first page opens the side menu; tap outside closes it
    document.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      S.edge = !S.drawer && t.clientX < 24 && ROOT_VIEWS.includes(App.current && App.current.view) && !body.classList.contains('sp-np-open') ? { x: t.clientX, y: t.clientY } : null;
      S.dclose = S.drawer ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true, capture: true });
    document.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (S.edge && t.clientX - S.edge.x > 60 && Math.abs(t.clientY - S.edge.y) < 60) openDrawer();
      if (S.dclose && S.dclose.x - t.clientX > 60) closeDrawer();
      S.edge = null; S.dclose = null;
    }, { passive: true, capture: true });
    const shade = html('<div id="sp-shade" class="sp-shade"></div>');
    shade.onclick = closeDrawer;
    document.body.appendChild(shade);
    State.on('profile', () => { renderTabs(); });
    renderTabs();
    renderBack();
    SpotPlayer.setup();
    App.render(true);
  }

  return {
    get active() { return S.active; }, setup, sheet, closeSheet, trackSheet, playlistPicker, share, createSheet,
    openDrawer, closeDrawer, renderTabs, renderBack, colorOf, firstSrc, cover, plural, avatar, me, haptic, isVideo,
    openSearch: (q) => { App.go('search'); setTimeout(() => SpotViews.focusSearch(q), 50); },
    openPlayer: () => SpotPlayer.open(),
  };
})();

// switch on after the app (and the classic phone layer) has started
(function () {
  const boot = App.boot;
  App.boot = async () => {
    await boot();
    if ((State.settings().iosLayout || 'standard') === 'classic') return;
    try { SpotUI.setup(); } catch (e) { console.error('phone layout failed', e); }
  };
})();
