// Aurora for iPhone, standard layout: the pages (Home, Search, Your Library, profile, playlists,
// albums, artists, listening stats, recents). See spot-core.js for the shell.
const SpotViews = (() => {
  const { cover, plural } = SpotUI;
  const NOT_ALBUMS = /^(downloads|spotify downloads|youtube|soundcloud|generic|vimeo|tiktok|twitter|instagram|bandcamp|web|unknown album|from friends)$/i;
  const realAlbum = (t) => t.album && !NOT_ALBUMS.test(t.album.trim()) ? t.album : null;
  const albumKey = (artist, album) => 'album:' + artist + '\u0001' + album;
  const MIX_COLORS = ['#7d5bff', '#ff5a5f', '#ff9f1c', '#2ec4b6', '#e84393', '#1ed760', '#4dabf7', '#f7b801', '#c77dff', '#ff6b6b'];
  const STATION_COLORS = ['#7ff5a8', '#ff6f61', '#c792ff', '#ffd166', '#7cc6fe', '#ff9ecd'];

  // ---------- data helpers ----------
  const tracks = () => State.allTracks();
  const byArtist = (name) => tracks().filter((t) => t.artist === name);
  const plays = (id) => (State.S.p.plays || {})[id] || 0;

  // albums: songs grouped by artist + album name
  function albums() {
    const m = new Map();
    for (const t of tracks()) {
      const al = realAlbum(t);
      if (!al) continue;
      const k = albumKey(t.artist, al);
      if (!m.has(k)) m.set(k, { key: k, name: al, artist: t.artist, ids: [], cover: null, addedAt: 0, liked: 0 });
      const a = m.get(k);
      a.ids.push(t.id);
      if (!a.cover && t.cover) a.cover = native.fileUrl(t.cover);
      a.addedAt = Math.max(a.addedAt, t.addedAt || 0);
      if (State.isLiked(t.id)) a.liked++;
    }
    return [...m.values()].map((a) => ({ ...a, cover: a.cover || genCover(a.name, '', 'music') }));
  }

  // albums and listening history are extra "collections" for the playlist page
  const baseCollection = State.collection;
  State.collection = (key) => {
    if (key && key.startsWith('album:')) {
      const [artist, name] = key.slice(6).split('\u0001');
      const items = tracks().filter((t) => t.artist === artist && realAlbum(t) === name).map((t) => ({ track: t, addedAt: t.addedAt }));
      if (!items.length) return null;
      const cv = items.find((i) => i.track.cover);
      return { key, type: 'Album', name, owner: artist, editable: false, cover: cv ? native.fileUrl(cv.track.cover) : genCover(name, '', 'music'), items };
    }
    if (key && key.startsWith('mix:')) {
      const name = key.slice(4);
      const ids = mixIds(name);
      return { key, type: 'Playlist', name: `${name} Mix`, owner: 'Aurora', editable: false, cover: artistCover(name), description: mixSub(name), items: ids.map((id) => ({ track: State.track(id), addedAt: 0 })).filter((i) => i.track) };
    }
    return baseCollection(key);
  };

  // play history (for Recents and Listening stats), kept per profile
  const countPlay = State.countPlay;
  State.countPlay = (id) => {
    countPlay(id);
    const h = (State.prefs().spHistory || []).slice(-2999);
    h.push({ id, at: Date.now() });
    State.S.p.prefs.spHistory = h; // saved with the next prefs write
  };
  const history = () => State.prefs().spHistory || [];

  function artistCover(name) {
    const t = byArtist(name).find((x) => x.cover);
    return t ? native.fileUrl(t.cover) : genCover(name, name);
  }
  // artists ranked by plays, favourites and how many songs you have
  function topArtists() {
    const m = new Map();
    for (const t of tracks()) {
      if (!t.artist || t.artist === 'Unknown artist') continue;
      const s = (m.get(t.artist) || 0) + 1 + plays(t.id) * 2 + (State.isLiked(t.id) ? 3 : 0);
      m.set(t.artist, s);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }
  // artists that appear in the same playlists (or albums) as this one
  function related(name) {
    const score = new Map();
    for (const pl of State.playlists()) {
      const arts = new Set(pl.items.map((i) => State.track(i.id)).filter(Boolean).map((t) => t.artist));
      if (!arts.has(name)) continue;
      for (const a of arts) if (a !== name && a !== 'Unknown artist') score.set(a, (score.get(a) || 0) + 1);
    }
    for (const a of topArtists().slice(0, 12)) if (a !== name && !score.has(a)) score.set(a, 0.1);
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  }
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function mixIds(name) {
    const own = byArtist(name).map((t) => t.id);
    const rel = related(name).slice(0, 5).flatMap((a) => byArtist(a).map((t) => t.id));
    return [...new Set([...shuffle(own).slice(0, 25), ...shuffle(rel).slice(0, 25)])];
  }
  function mixSub(name) {
    const r = related(name).slice(0, 3);
    return r.length ? `${r.join(', ')} and more` : `${name} and more`;
  }
  function playRadio(artist, seed) {
    let ids = mixIds(artist);
    if (seed) ids = [seed, ...ids.filter((x) => x !== seed)];
    if (!ids.length) return UI.toast('Nothing to play yet');
    Player.playContext({ key: 'mix:' + artist, name: `${artist} Radio` }, ids, 0);
  }
  const playKey = (key) => App.playCollection(key);
  const playIds = (ctx, ids, i = 0) => ids.length && Player.playContext(ctx, ids, i);

  function recentCollections() {
    return State.libraryEntries().filter((e) => e.at > 1).sort((a, b) => b.at - a.at);
  }
  function recentTracks(n = 30) {
    const seen = new Set(), out = [];
    for (const h of history().slice().reverse()) {
      if (seen.has(h.id)) continue;
      const t = State.track(h.id);
      if (!t) continue;
      seen.add(h.id); out.push({ t, at: h.at });
      if (out.length >= n) break;
    }
    return out;
  }

  // ---------- shared pieces ----------
  // a song row: cover, title, "downloaded" mark, artist, and "…" (or an add button)
  function row(t, opts = {}) {
    const playing = Player.current && Player.current.id === t.id;
    const el = html(`<div class="sp-row ${playing ? 'playing' : ''}" data-id="${esc(t.id)}">
      ${opts.num ? `<span class="sp-num">${opts.num}</span>` : ''}
      ${opts.noCover ? '' : cover(UI.coverSrc(t), 'sp-row-cover')}
      <div class="sp-row-t"><b>${esc(t.title)}</b><span>${opts.sub !== undefined ? opts.sub : `<i class="sp-dl">${icon('dl', 13)}</i>${isVid(t) ? '<em class="sp-tag">VIDEO</em>' : ''}${esc(opts.type ? `${opts.type} • ${t.artist}` : t.artist)}`}</span></div>
      ${opts.add ? `<button class="sp-row-add">${icon(State.isLiked(t.id) ? 'addedCircle' : 'addCircle', 24)}</button>` : ''}
      ${opts.remove ? `<button class="sp-row-x">${icon('close', 20)}</button>` : ''}
      ${opts.dots === false ? '' : `<button class="sp-row-dots">${icon('dotsH', 20)}</button>`}
    </div>`);
    if (State.isLiked(t.id) && opts.add) $('.sp-row-add', el).classList.add('on');
    el.onclick = (e) => {
      if (e.target.closest('.sp-row-dots')) { e.stopPropagation(); return SpotUI.trackSheet(t, { playlistId: opts.playlistId }); }
      if (e.target.closest('.sp-row-add')) { e.stopPropagation(); const v = State.toggleLike(t.id); SpotUI.haptic('medium'); const b = $('.sp-row-add', el); b.innerHTML = icon(v ? 'addedCircle' : 'addCircle', 24); b.classList.toggle('on', v); UI.toast(v ? 'Added to Favorites' : 'Removed from Favorites'); return; }
      if (e.target.closest('.sp-row-x')) { e.stopPropagation(); return opts.remove(); }
      if (opts.onOpen) return opts.onOpen();
      if (opts.play) opts.play();
    };
    el._spMenu = () => SpotUI.trackSheet(t, { playlistId: opts.playlistId });
    swipeToQueue(el, t);
    return el;
  }
  const isVid = (t) => t.kind === 'video';

  // swipe a song to the right to add it to the queue
  function swipeToQueue(el, t) {
    let x0 = null, y0 = 0, dx = 0, lock = null;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; lock = null; }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (x0 === null) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (lock === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) lock = Math.abs(mx) > Math.abs(my) && mx > 0 ? 'x' : 'y';
      if (lock !== 'x') return;
      dx = Math.max(0, Math.min(110, mx));
      el.style.transform = `translateX(${dx}px)`;
      el.classList.toggle('sp-swiping', dx > 70);
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (x0 === null) return;
      if (lock === 'x' && dx > 70) { Player.addToQueue([t.id]); SpotUI.haptic('medium'); UI.toast(`Added to queue: ${t.title}`); }
      el.style.transform = ''; el.classList.remove('sp-swiping');
      x0 = null;
    }, { passive: true });
  }

  // a square card with two lines under it
  function card({ title, sub, src, round, onOpen, label, labelColor, cls = '', badge }) {
    const el = html(`<div class="sp-card ${round ? 'round' : ''} ${cls}">
      <div class="sp-card-art">${cover(src, 'sp-card-cover', round)}${label ? `<span class="sp-mixlabel" style="--mc:${labelColor}"><b>${esc(label)}</b></span>` : ''}${badge ? `<span class="sp-card-badge">${badge}</span>` : ''}</div>
      ${title ? `<b class="sp-card-title">${esc(title)}</b>` : ''}
      ${sub ? `<span class="sp-card-sub">${sub}</span>` : ''}
    </div>`);
    el.onclick = () => onOpen && onOpen();
    return el;
  }
  function stationCard(name, i) {
    const rel = related(name).slice(0, 2);
    const el = html(`<div class="sp-card sp-station">
      <div class="sp-card-art sp-station-art" style="--sc:${STATION_COLORS[i % STATION_COLORS.length]}">
        <span class="sp-radio-tag">RADIO</span>
        <div class="sp-station-pics">
          ${rel[0] ? cover(artistCover(rel[0]), 'sp-st-side', true) : ''}
          ${cover(artistCover(name), 'sp-st-main', true)}
          ${rel[1] ? cover(artistCover(rel[1]), 'sp-st-side', true) : ''}
        </div>
        <b class="sp-station-name">${esc(name)}</b>
      </div>
      <span class="sp-card-sub">${esc(rel.length ? rel.join(', ') + ' and more' : 'Songs like ' + name)}</span>
    </div>`);
    el.onclick = () => playRadio(name);
    return el;
  }
  function shelf(title, cards, opts = {}) {
    if (!cards.length) return document.createDocumentFragment();
    const el = html(`<section class="sp-shelf">
      <div class="sp-shelf-head">${opts.pre ? `<span class="sp-shelf-pre">${opts.pre}</span>` : ''}<h2>${esc(title)}</h2>${opts.onMore ? '<button class="sp-more">Show all</button>' : ''}</div>
      <div class="sp-shelf-row"></div>
    </section>`);
    const rowEl = $('.sp-shelf-row', el);
    cards.forEach((c) => rowEl.appendChild(c));
    if (opts.onMore) $('.sp-more', el).onclick = opts.onMore;
    return el;
  }
  function header(title, right = '') {
    const el = html(`<div class="sp-head"><button class="sp-head-av">${SpotUI.avatar(34)}</button><h1>${esc(title)}</h1><div class="sp-head-r">${right}</div></div>`);
    $('.sp-head-av', el).onclick = () => SpotUI.openDrawer();
    return el;
  }
  const keyOpen = (k) => () => App.go('collection', k);

  // ---------- Home ----------
  const home = {
    render(root) {
      const pr = State.prefs();
      let filter = pr.spHomeFilter || 'all';
      const top = html(`<div class="sp-home-top"><button class="sp-head-av">${SpotUI.avatar(34)}</button><div class="sp-chips"></div></div>`);
      $('.sp-head-av', top).onclick = () => SpotUI.openDrawer();
      const chips = $('.sp-chips', top);
      for (const [k, l] of [['all', 'All'], ['music', 'Music'], ['videos', 'Videos'], ['friends', 'Friends']]) {
        const c = html(`<button class="sp-chip ${filter === k ? 'on' : ''}">${l}</button>`);
        c.onclick = () => { State.setPref('spHomeFilter', k === filter ? 'all' : k); App.render(true); };
        chips.appendChild(c);
      }
      root.appendChild(top);
      const all = tracks();
      if (!all.length) {
        root.appendChild(html(`<div class="sp-empty">${icon('note', 54)}<b>Let's fill your library</b><span>Download songs and videos from a link, search YouTube or SoundCloud, or add files from your iPhone.</span><div class="sp-empty-btns"><button class="sp-pill white" data-a="dl">Download from a link</button><button class="sp-pill" data-a="disc">Search to download</button><button class="sp-pill" data-a="files">Add from Files</button></div></div>`));
        $$('[data-a]', root).forEach((b) => b.onclick = () => ({ dl: () => App.go('downloader'), disc: () => App.go('discover'), files: () => App.importFiles() })[b.dataset.a]());
        return;
      }
      if (filter === 'friends') return friendsHome(root);
      const music = filter === 'music', videos = filter === 'videos';
      const okTrack = (t) => (music ? !isVid(t) : videos ? isVid(t) : true);

      // 8 shortcuts
      if (!videos) {
        const sc = recentCollections().filter((e) => e.kind !== 'video' || !music).slice(0, 8);
        if (sc.length < 8) for (const e of State.libraryEntries()) if (sc.length < 8 && !sc.includes(e)) sc.push(e);
        const grid = html('<div class="sp-shortcuts"></div>');
        for (const e of sc) {
          const playing = Player.isCurrentContext(e.key) && Player.playing;
          const el = html(`<button class="sp-sc ${playing ? 'playing' : ''}">${cover(e.cover, 'sp-sc-cover', e.round)}<b>${esc(e.name)}</b>${playing ? `<span class="sp-eq"><i></i><i></i><i></i></span>` : ''}</button>`);
          el.onclick = keyOpen(e.key);
          el._spMenu = () => App.collectionMenu(e.key, 0, 0);
          grid.appendChild(el);
        }
        root.appendChild(grid);
      }

      if (videos) {
        const vids = all.filter(isVid).sort((a, b) => b.addedAt - a.addedAt);
        root.appendChild(videoHero(vids[0]));
        root.appendChild(shelf('Your videos', vids.slice(0, 20).map((t, i) => card({ title: t.title, sub: esc(t.artist), src: UI.coverSrc(t), cls: 'wide', badge: t.duration ? fmtTime(t.duration) : '', onOpen: () => playIds({ key: 'videos', name: 'Videos' }, vids.map((x) => x.id), i) }))));
        const va = topArtists().filter((a) => byArtist(a).some(isVid)).slice(0, 10);
        root.appendChild(shelf('Artists with videos', va.map((a) => card({ title: a, sub: 'Artist', src: artistCover(a), round: true, onOpen: keyOpen('artist:' + a) }))));
        return;
      }

      // Jump back in
      const jump = recentCollections().slice(0, 10);
      root.appendChild(shelf('Jump back in', jump.map((e) => card({ title: e.kind === 'artist' ? '' : e.name, sub: e.kind === 'artist' ? `<small>Artist</small><b>${esc(e.name)}</b>` : esc(e.sub), src: e.cover, round: e.round, onOpen: keyOpen(e.key) }))));

      // Recents
      const rec = recentTracks(14).filter(({ t }) => okTrack(t));
      root.appendChild(shelf('Recents', rec.map(({ t }) => card({ title: t.title, sub: `${isVid(t) ? 'Video' : 'Song'} • ${esc(t.artist)}`, src: UI.coverSrc(t), cls: 'small', onOpen: () => playIds({ key: 'recents', name: 'Recents' }, rec.map((x) => x.t.id), rec.findIndex((x) => x.t.id === t.id)) })), { onMore: () => App.go('sprecents') }));

      // Your top mixes
      const ta = topArtists();
      root.appendChild(shelf('Your top mixes', ta.slice(0, 8).map((a, i) => card({ title: '', sub: esc(mixSub(a)), src: artistCover(a), label: `${a} Mix`, labelColor: MIX_COLORS[i % MIX_COLORS.length], onOpen: keyOpen('mix:' + a) }))));

      // Recommended Stations
      root.appendChild(shelf('Recommended Stations', ta.slice(0, 8).map((a, i) => stationCard(a, i))));

      // Albums featuring songs you like
      const al = albums().sort((a, b) => (b.liked - a.liked) || (b.addedAt - a.addedAt)).slice(0, 12);
      root.appendChild(shelf(al.some((a) => a.liked) ? 'Albums featuring songs you like' : 'Albums in your library', al.map((a) => card({ title: a.name, sub: esc(a.artist), src: a.cover, onOpen: keyOpen(a.key) }))));

      // Your playlists
      const pls = State.playlists();
      root.appendChild(shelf('Your playlists', pls.map((p) => card({ title: p.name, sub: esc(SpotUI.me().name), src: State.playlistCover(p), onOpen: keyOpen('pl:' + p.id) }))));

      // a video, big
      if (!music) { const v = all.filter(isVid).sort((a, b) => b.addedAt - a.addedAt)[0]; if (v) root.appendChild(videoHero(v)); }

      // recently added
      const added = all.filter(okTrack).sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
      root.appendChild(shelf('Recently added', added.map((t, i) => card({ title: t.title, sub: esc(t.artist), src: UI.coverSrc(t), onOpen: () => playIds({ key: 'downloads', name: 'Recently added' }, added.map((x) => x.id), i) }))));

      // your artists
      root.appendChild(shelf('Your favorite artists', ta.slice(0, 12).map((a) => card({ title: a, sub: 'Artist', src: artistCover(a), round: true, onOpen: keyOpen('artist:' + a) }))));

      // find more
      const more = html(`<button class="sp-discover-card"><div><small>DISCOVER</small><b>Find new music and videos</b><span>Search YouTube and SoundCloud and keep anything in your library.</span></div>${icon('search', 28)}</button>`);
      more.onclick = () => App.go('discover');
      root.appendChild(more);
    },
  };
  function videoHero(t) {
    if (!t) return document.createDocumentFragment();
    const el = html(`<section class="sp-shelf"><div class="sp-video-hero">${cover(UI.coverSrc(t), 'sp-vh-cover')}<span class="sp-vh-time">${t.duration ? fmtTime(t.duration) : 'VIDEO'}</span><div class="sp-vh-text"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div><span class="sp-vh-play">${icon('play', 22)}</span></div></section>`);
    $('.sp-video-hero', el).onclick = () => { playIds({ key: 'videos', name: 'Videos' }, [t.id]); SpotPlayer.open(); };
    return el;
  }
  function friendsHome(root) {
    const fr = Friends.friends();
    if (!fr.length) {
      root.appendChild(html(`<div class="sp-empty">${icon('users', 54)}<b>Music is better with friends</b><span>Add friends with their friend code to see what they're listening to and download their songs.</span><div class="sp-empty-btns"><button class="sp-pill white">Add friends</button></div></div>`));
      $('.sp-pill', root).onclick = () => App.go('friends');
      return;
    }
    const list = html('<div class="sp-list"></div>');
    for (const f of fr) {
      const s = Friends.statusOf(f.code);
      const name = f.nickname || s.name || f.code;
      const on = s.status && !['offline', 'unknown'].includes(s.status);
      const el = html(`<div class="sp-lrow"><span class="sp-fr-av" style="background:${esc(s.color || colorFor(name))}">${s.avatar ? `<img src="${esc(s.avatar)}" />` : esc(name[0])}${on ? '<i></i>' : ''}</span><div class="sp-row-t"><b>${esc(name)}</b><span>${s.track ? `${icon('note', 12)} ${esc(s.track.title)} • ${esc(s.track.artist || '')}` : on ? 'Online' : 'Offline'}</span></div><button class="sp-pill sm">Library</button></div>`);
      el.onclick = () => App.go('friendlib', f.code);
      list.appendChild(el);
    }
    root.appendChild(html('<h2 class="sp-h2">Friend activity</h2>'));
    root.appendChild(list);
  }

  // ---------- Search ----------
  const BROWSE = [
    ['Music', '#dc148c', 'music', () => App.go('collection', 'downloads')],
    ['Videos', '#006450', 'video', () => App.go('collection', 'videos')],
    ['Download', '#1e3264', 'download', () => App.go('downloader')],
    ['Listen Together', '#8400e7', 'together', () => App.go('together')],
  ];
  let searchMode = false, searchQ = '';
  const recentSearches = () => State.prefs().spSearches || [];
  function addRecentSearch(item) {
    const list = recentSearches().filter((x) => !(x.k === item.k && x.v === item.v));
    list.unshift(item);
    State.setPref('spSearches', list.slice(0, 30));
  }
  const search = {
    live: false,
    render(root, query) {
      if (query) { searchMode = true; searchQ = String(query); }
      if (searchMode) return renderSearchMode(root);
      root.appendChild(header('Search', `<button class="sp-icon-btn sp-cam">${icon('camera', 26)}</button>`));
      $('.sp-cam', root).onclick = () => App.go('downloader');
      const box = html(`<button class="sp-searchbox">${icon('search', 24)}<span>What do you want to listen to?</span></button>`);
      box.onclick = () => focusSearch();
      root.appendChild(box);
      const tiles = html('<div class="sp-browse-top"></div>');
      const covs = tracks().filter((t) => t.cover);
      BROWSE.forEach(([name, color, ic, go], i) => {
        const c = covs[i] ? native.fileUrl(covs[i].cover) : null;
        const el = html(`<button class="sp-btile" style="background:${color}"><b>${esc(name)}</b>${c ? `<img src="${esc(c)}" />` : `<span class="sp-btile-ic">${icon(ic, 34)}</span>`}</button>`);
        el.onclick = go;
        tiles.appendChild(el);
      });
      root.appendChild(tiles);
      // tall "discover" cards
      const ta = topArtists().slice(0, 8);
      if (ta.length) {
        const sec = html('<section class="sp-shelf"><div class="sp-shelf-head"><h2>Discover something new</h2></div><div class="sp-shelf-row"></div></section>');
        ta.forEach((a) => {
          const el = html(`<button class="sp-tall">${cover(artistCover(a), 'sp-tall-cover')}<b>#${esc(a.toLowerCase().replace(/\s+/g, ''))}</b></button>`);
          el.onclick = () => playRadio(a);
          $('.sp-shelf-row', sec).appendChild(el);
        });
        root.appendChild(sec);
      }
      // browse all
      const items = [
        ['Made For You', '#8d67ab', () => App.go('collection', ta[0] ? 'mix:' + ta[0] : 'downloads')],
        ['Recently added', '#e8115b', () => App.go('collection', 'downloads')],
        ['Favorites', '#477d95', () => App.go('collection', 'liked')],
        ['Videos', '#e13300', () => App.go('collection', 'videos')],
        ['Discover', '#1e3264', () => App.go('discover')],
        ['Listening stats', '#148a08', () => App.go('spstats')],
        ['Friends', '#509bf5', () => App.go('friends')],
        ['Aurora Store', '#bc5900', () => App.go('store')],
        ...albums().slice(0, 6).map((a) => [a.name, colorFor(a.name), () => App.go('collection', a.key), a.cover]),
        ...State.playlists().slice(0, 6).map((p) => [p.name, colorFor(p.id), () => App.go('collection', 'pl:' + p.id), State.playlistCover(p)]),
      ];
      const sec = html('<section class="sp-shelf"><div class="sp-shelf-head"><h2>Browse all</h2></div><div class="sp-browse-grid"></div></section>');
      items.forEach(([name, color, go, cv], i) => {
        const src = SpotUI.firstSrc(cv) || (covs[(i + 4) % Math.max(1, covs.length)] ? native.fileUrl(covs[(i + 4) % covs.length].cover) : null);
        const el = html(`<button class="sp-bcat" style="background:${color}"><b>${esc(name)}</b>${src ? `<img src="${esc(src)}" />` : ''}</button>`);
        el.onclick = go;
        $('.sp-browse-grid', sec).appendChild(el);
      });
      root.appendChild(sec);
    },
  };
  function focusSearch(q) {
    searchMode = true;
    if (typeof q === 'string') searchQ = q;
    if (App.current && App.current.view === 'search') App.render(true); else App.go('search');
    setTimeout(() => { const i = $('#sp-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 30);
  }
  function renderSearchMode(root) {
    const bar = html(`<div class="sp-sbar"><div class="sp-sinput">${icon('search', 20)}<input id="sp-q" type="search" placeholder="What do you want to listen to?" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" /><button class="sp-sclear">${icon('close', 14)}</button></div><button class="sp-cancel">Cancel</button></div>`);
    root.appendChild(bar);
    const out = html('<div class="sp-sresults"></div>');
    root.appendChild(out);
    const input = $('#sp-q', bar);
    input.value = searchQ;
    $('.sp-cancel', bar).onclick = () => { searchMode = false; searchQ = ''; input.blur(); App.render(true); };
    $('.sp-sclear', bar).onclick = () => { input.value = ''; searchQ = ''; draw(); input.focus(); };
    input.addEventListener('input', debounce(() => { searchQ = input.value; draw(); }, 90));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); if (input.value.trim()) addRecentSearch({ k: 'q', v: input.value.trim() }); } });
    const draw = () => {
      out.innerHTML = '';
      bar.classList.toggle('has-q', !!searchQ);
      const q = searchQ.trim();
      if (!q) return drawRecent(out, (v) => { input.value = v; searchQ = v; draw(); });
      if (/^https?:\/\//i.test(q)) {
        const el = html(`<div class="sp-lrow">${icon('link', 28)}<div class="sp-row-t"><b>Download this link</b><span>${esc(q)}</span></div><button class="sp-pill sm white">Download</button></div>`);
        el.onclick = () => { searchMode = false; App.go('downloader', q); };
        out.appendChild(el);
        return;
      }
      const ql = q.toLowerCase();
      const score = (t) => {
        const s = `${t.title} ${t.artist} ${t.album || ''}`.toLowerCase();
        if (!s.includes(ql)) return ql.split(/\s+/).every((w) => s.includes(w)) ? 1 : 0;
        return t.title.toLowerCase().startsWith(ql) ? 4 : t.artist.toLowerCase().startsWith(ql) ? 3 : 2;
      };
      const ts = tracks().map((t) => [t, score(t)]).filter(([, s]) => s).sort((a, b) => b[1] - a[1]).map(([t]) => t);
      const arts = State.artists().filter((a) => a.name.toLowerCase().includes(ql)).sort((a, b) => b.count - a.count);
      const als = albums().filter((a) => a.name.toLowerCase().includes(ql) || a.artist.toLowerCase().includes(ql));
      const pls = State.playlists().filter((p) => p.name.toLowerCase().includes(ql));
      // suggestions (words from your library that start with what you typed)
      const words = new Set();
      for (const t of tracks()) for (const s of [t.title, t.artist]) if (s && s.toLowerCase().startsWith(ql) && s.toLowerCase() !== ql) words.add(s.toLowerCase());
      const sugg = [...words].slice(0, 4);
      const hist = recentSearches().filter((x) => x.k === 'q' && x.v.toLowerCase().startsWith(ql) && x.v.toLowerCase() !== ql).slice(0, 2);
      for (const s of [...hist.map((x) => ({ v: x.v, h: true })), ...sugg.map((v) => ({ v }))].slice(0, 5)) {
        const el = html(`<div class="sp-sugg">${icon(s.h ? 'history' : 'search', 20)}<span><b>${esc(s.v.slice(0, q.length))}</b>${esc(s.v.slice(q.length))}</span><button class="sp-sugg-fill">${icon('arrowUpLeft', 20)}</button></div>`);
        el.onclick = (e) => { input.value = s.v; searchQ = s.v; draw(); if (!e.target.closest('.sp-sugg-fill')) { addRecentSearch({ k: 'q', v: s.v }); input.blur(); } };
        out.appendChild(el);
      }
      const results = [];
      arts.slice(0, 2).forEach((a) => results.push({ kind: 'artist', a }));
      ts.slice(0, 2).forEach((t) => results.push({ kind: 'track', t }));
      als.slice(0, 2).forEach((a) => results.push({ kind: 'album', a }));
      pls.slice(0, 2).forEach((p) => results.push({ kind: 'pl', p }));
      ts.slice(2, 14).forEach((t) => results.push({ kind: 'track', t }));
      arts.slice(2, 5).forEach((a) => results.push({ kind: 'artist', a }));
      for (const r of results) out.appendChild(resultRow(r, ts, q));
      const web = html(`<div class="sp-lrow sp-web">${icon('download', 26)}<div class="sp-row-t"><b>Search YouTube and SoundCloud</b><span>Find "${esc(q)}" online and download it</span></div>${icon('chevronRight', 20)}</div>`);
      web.onclick = () => { addRecentSearch({ k: 'q', v: q }); searchMode = false; App.go('discover', q); };
      out.appendChild(web);
      if (!results.length) out.appendChild(html(`<div class="sp-noresults"><b>Couldn't find "${esc(q)}"</b><span>Try searching again using a different spelling or keyword, or search online above.</span></div>`));
    };
    draw();
  }
  function resultRow(r, ts, q) {
    if (r.kind === 'track') {
      const t = r.t;
      return row(t, { type: isVid(t) ? 'Video' : 'Song', add: true, play: () => { addRecentSearch({ k: 't', v: t.id }); playIds({ key: 'search', name: `Search: ${q}` }, ts.map((x) => x.id), ts.indexOf(t)); } });
    }
    const [title, sub, src, round, key, rec] = r.kind === 'artist'
      ? [r.a.name, 'Artist', r.a.cover ? native.fileUrl(r.a.cover) : genCover(r.a.name, r.a.name), true, 'artist:' + r.a.name, { k: 'a', v: r.a.name }]
      : r.kind === 'album' ? [r.a.name, `Album • ${r.a.artist}`, r.a.cover, false, r.a.key, { k: 'al', v: r.a.key }]
        : [r.p.name, `Playlist • ${SpotUI.me().name}`, State.playlistCover(r.p), false, 'pl:' + r.p.id, { k: 'p', v: r.p.id }];
    const el = html(`<div class="sp-lrow">${cover(src, 'sp-row-cover', round)}<div class="sp-row-t"><b>${esc(title)}${r.kind === 'artist' ? ` <span class="sp-verified">${icon('checkCircle', 14)}</span>` : ''}</b><span>${esc(sub)}</span></div></div>`);
    el.onclick = () => { addRecentSearch(rec); searchMode = false; App.go('collection', key); };
    return el;
  }
  function drawRecent(out, fill) {
    const list = recentSearches();
    if (!list.length) {
      out.appendChild(html(`<div class="sp-noresults"><b>Play what you love</b><span>Search your songs, artists, albums and playlists, or anything on YouTube and SoundCloud.</span></div>`));
      return;
    }
    out.appendChild(html('<h2 class="sp-h2">Recent searches</h2>'));
    for (const r of list) {
      let el = null;
      const remove = () => { State.setPref('spSearches', recentSearches().filter((x) => !(x.k === r.k && x.v === r.v))); el.remove(); };
      if (r.k === 't') { const t = State.track(r.v); if (!t) continue; el = row(t, { type: isVid(t) ? 'Video' : 'Song', add: true, dots: false, remove, play: () => playIds({ key: 'search', name: 'Recent searches' }, [t.id]) }); }
      else if (r.k === 'a') { el = html(`<div class="sp-lrow">${cover(artistCover(r.v), 'sp-row-cover', true)}<div class="sp-row-t"><b>${esc(r.v)} <span class="sp-verified">${icon('checkCircle', 14)}</span></b><span>Artist</span></div><button class="sp-row-x">${icon('close', 20)}</button></div>`); el.onclick = (e) => (e.target.closest('.sp-row-x') ? remove() : (searchMode = false, App.go('collection', 'artist:' + r.v))); }
      else if (r.k === 'al' || r.k === 'p') {
        const c = State.collection(r.k === 'p' ? 'pl:' + r.v : r.v);
        if (!c) continue;
        el = html(`<div class="sp-lrow">${cover(c.cover, 'sp-row-cover')}<div class="sp-row-t"><b>${esc(c.name)}</b><span>${r.k === 'p' ? 'Playlist' : 'Album'} • ${esc(c.owner)}</span></div><button class="sp-row-x">${icon('close', 20)}</button></div>`);
        el.onclick = (e) => (e.target.closest('.sp-row-x') ? remove() : (searchMode = false, App.go('collection', c.key)));
      } else {
        el = html(`<div class="sp-lrow"><span class="sp-q-ic">${icon('search', 22)}</span><div class="sp-row-t"><b>${esc(r.v)}</b></div><button class="sp-row-x">${icon('close', 20)}</button></div>`);
        el.onclick = (e) => (e.target.closest('.sp-row-x') ? remove() : fill(r.v));
      }
      out.appendChild(el);
    }
    const clr = html('<button class="sp-pill sp-clear-recent">Clear recent searches</button>');
    clr.onclick = () => { State.setPref('spSearches', []); out.innerHTML = ''; drawRecent(out, fill); };
    out.appendChild(clr);
  }

  // ---------- Your Library ----------
  const yourlib = {
    render(root) {
      const pr = State.prefs();
      let filter = pr.spLibFilter || null;
      let sort = pr.spLibSort || 'recents';
      let grid = pr.spLibView === 'grid';
      let q = '';
      root.appendChild(header('Your Library', `<button class="sp-icon-btn sp-lsearch">${icon('search', 24)}</button><button class="sp-icon-btn sp-ladd">${icon('plusBig', 26)}</button>`));
      const chips = html('<div class="sp-chips sp-lchips"></div>');
      root.appendChild(chips);
      const filt = html(`<div class="sp-lfind" hidden><div class="sp-sinput">${icon('search', 18)}<input type="search" placeholder="Find in Your Library" /></div></div>`);
      root.appendChild(filt);
      const bar = html(`<div class="sp-lbar"><button class="sp-lsort">${icon('sortArrows', 18)}<span></span></button><button class="sp-icon-btn sp-lview"></button></div>`);
      root.appendChild(bar);
      const list = html('<div class="sp-llist"></div>');
      root.appendChild(list);
      const SORTS = { recents: 'Recents', added: 'Recently added', alpha: 'Alphabetical', creator: 'Creator' };
      const kinds = [['playlist', 'Playlists'], ['album', 'Albums'], ['artist', 'Artists'], ['download', 'Downloaded'], ['video', 'Videos']];

      const entries = () => {
        const out = State.libraryEntries().map((e) => ({ ...e, kind: e.kind === 'download' ? 'playlist' : e.kind }));
        for (const a of albums()) out.push({ key: a.key, name: a.name, sub: `Album • ${a.artist}`, cover: a.cover, kind: 'album', at: State.lastPlayed('collection', a.key) || a.addedAt, owner: a.artist, pinned: State.isPinned(a.key) });
        return out;
      };
      const draw = () => {
        chips.innerHTML = '';
        if (filter) { const x = html(`<button class="sp-chip x">${icon('close', 14)}</button>`); x.onclick = () => { filter = null; State.setPref('spLibFilter', null); draw(); }; chips.appendChild(x); }
        for (const [k, l] of kinds) {
          if (filter && filter !== k) continue;
          const c = html(`<button class="sp-chip ${filter === k ? 'on' : ''}">${l}</button>`);
          c.onclick = () => { filter = filter === k ? null : k; State.setPref('spLibFilter', filter); draw(); };
          chips.appendChild(c);
        }
        $('.sp-lsort span', bar).textContent = SORTS[sort];
        $('.sp-lview', bar).innerHTML = icon(grid ? 'listLines' : 'grid', 20);
        let es = entries();
        if (filter === 'download') es = es.filter((e) => e.key === 'downloads' || e.key === 'local' || e.key.startsWith('pl:') || e.kind === 'album');
        else if (filter === 'video') es = es.filter((e) => e.key === 'videos' || (e.kind === 'artist' && byArtist(e.name).some(isVid)));
        else if (filter) es = es.filter((e) => e.kind === filter);
        if (q) es = es.filter((e) => e.name.toLowerCase().includes(q));
        const cmp = { recents: (a, b) => b.at - a.at, added: (a, b) => b.at - a.at, alpha: (a, b) => a.name.localeCompare(b.name), creator: (a, b) => String(a.owner || a.sub).localeCompare(String(b.owner || b.sub)) }[sort];
        es.sort((a, b) => (b.pinned - a.pinned) || cmp(a, b));
        list.className = 'sp-llist ' + (grid ? 'grid' : '');
        list.innerHTML = '';
        if (!es.length) { list.appendChild(html(`<div class="sp-noresults"><b>Nothing here yet</b><span>${q ? 'Try another name.' : 'Download or add music to see it here.'}</span></div>`)); return; }
        for (const e of es) {
          const playing = Player.isCurrentContext(e.key);
          const sub = `${e.pinned ? `<i class="sp-pin">${icon('pin', 13)}</i>` : ''}${esc(e.sub.replace(' • ', ' • '))}`;
          const el = html(grid
            ? `<button class="sp-lgrid">${cover(e.cover, 'sp-lg-cover', e.round)}<b class="${playing ? 'sp-green' : ''}">${esc(e.name)}</b><span>${sub}</span></button>`
            : `<button class="sp-lrow">${cover(e.cover, 'sp-lcover', e.round)}<div class="sp-row-t"><b class="${playing ? 'sp-green' : ''}">${esc(e.name)}</b><span>${sub}</span></div>${playing && Player.playing ? '<span class="sp-eq"><i></i><i></i><i></i></span>' : ''}</button>`);
          el.onclick = keyOpen(e.key);
          el._spMenu = () => collectionSheet(e.key);
          list.appendChild(el);
        }
      };
      $('.sp-lsearch', root).onclick = () => { filt.hidden = !filt.hidden; if (!filt.hidden) $('input', filt).focus(); else { q = ''; $('input', filt).value = ''; draw(); } };
      $('input', filt).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); draw(); });
      $('.sp-ladd', root).onclick = () => SpotUI.createSheet();
      $('.sp-lsort', bar).onclick = () => SpotUI.sheet(Object.entries(SORTS).map(([k, l]) => ({ icon: 'sortArrows', label: l, on: k === sort, action: () => { sort = k; State.setPref('spLibSort', k); draw(); } })), { title: 'Sort by' });
      $('.sp-lview', bar).onclick = () => { grid = !grid; State.setPref('spLibView', grid ? 'grid' : 'list'); draw(); };
      draw();
      const off = State.on('library', debounce(draw, 150));
      const off2 = Player.on ? null : null;
      return () => { off(); off2 && off2(); };
    },
    live: false,
  };

  // long press on a playlist / album / artist
  function collectionSheet(key) {
    const c = State.collection(key);
    if (!c) return;
    const pinned = State.isPinned(key);
    const ids = c.items.map((i) => i.track.id);
    SpotUI.sheet([
      { icon: 'play', label: 'Play', action: () => playIds({ key, name: c.name }, ids, 0) },
      { icon: 'shuffle', label: 'Shuffle play', action: () => { if (!Player.P.shuffle) Player.toggleShuffle(); playIds({ key, name: c.name }, ids, -1); } },
      { icon: 'queue', label: 'Add to queue', action: () => { Player.addToQueue(ids); UI.toast(`Added ${plural(ids.length, 'song')} to queue`); } },
      { icon: 'pin', label: pinned ? 'Unpin' : `Pin ${c.type.toLowerCase()}`, on: pinned, action: () => State.togglePin(key) },
      { icon: 'addCircle', label: 'Add to another playlist', action: () => SpotUI.playlistPicker(ids) },
      c.editable ? { icon: 'edit', label: 'Edit playlist', action: () => App.collectionMenu(key, innerWidth / 2, innerHeight / 2) } : null,
      c.editable ? { icon: 'trash', label: 'Delete playlist', danger: true, action: async () => { if (await native.dialog.confirm({ message: `Delete "${c.name}"?`, ok: 'Delete' })) { State.deletePlaylist(key.slice(3)); App.go('yourlib'); } } } : null,
    ], { head: `<div class="sp-sh-track">${cover(c.cover, 'sp-sh-cover', c.round)}<div><b>${esc(c.name)}</b><span>${esc(c.type)} • ${esc(c.owner)}</span></div></div>` });
  }

  // ---------- profile ----------
  const baseProfile = Views.profile;
  const profile = {
    render(root, id) {
      const p = State.profiles().find((x) => x.id === id) || State.activeProfile();
      if (!p || p.id !== State.S.profiles.activeId) return baseProfile.render(root, id);
      const pls = State.playlists();
      const friends = Friends.friends().length;
      const head = html(`<div class="sp-prof-head" style="--pc:${esc(p.color || '#535353')}">
        <div class="sp-prof-row">${UI.avatarHtml(p, 118)}<div><h1>${esc(p.name)}</h1><span><b>${friends}</b> ${friends === 1 ? 'friend' : 'friends'} • <b>${pls.length}</b> ${pls.length === 1 ? 'playlist' : 'playlists'}</span></div></div>
        ${p.bio ? `<p class="sp-prof-bio">${esc(p.bio)}</p>` : ''}
        <div class="sp-prof-btns"><button class="sp-pill sm sp-edit">Edit</button><button class="sp-icon-btn sp-pshare">${icon('share', 24)}</button><button class="sp-icon-btn sp-pset">${icon('gear', 24)}</button><button class="sp-icon-btn sp-pmore">${icon('dotsH', 24)}</button></div>
      </div>`);
      if (p.avatar) SpotUI.colorOf(p.avatar, p.color).then((c) => head.style.setProperty('--pc', c));
      root.appendChild(head);
      $('.sp-edit', head).onclick = () => Views.profile.customize(p);
      $('.sp-pset', head).onclick = () => App.go('settings');
      $('.sp-pshare', head).onclick = async () => {
        const code = Friends.myCode();
        const text = `Add me on Aurora! My friend code is ${code}`;
        try { if (navigator.share) return await navigator.share({ text }); } catch (e) { if (e.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(code); UI.toast(`Friend code ${code} copied`); } catch { UI.toast(text, 5000); }
      };
      $('.sp-pmore', head).onclick = () => SpotUI.sheet([
        { icon: 'users', label: 'Switch profile', action: () => App.showProfilePicker() },
        { icon: 'transfer', label: 'Transfer songs', action: () => Views.transfer.open() },
        { icon: 'cloud', label: typeof Account !== 'undefined' && Account.signedIn() ? 'Aurora Account' : 'Sign in to sync', action: () => App.go('account') },
        { icon: 'users', label: 'Friends', action: () => App.go('friends') },
        { icon: 'edit', label: 'Edit profile', action: () => Views.profile.editModal ? Views.profile.editModal(p) : Views.profile.customize(p) },
      ]);
      const sec = html(`<section class="sp-prof-sec"><div class="sp-shelf-head"><h2>Playlists</h2><button class="sp-manage">${icon('edit', 18)} Manage</button></div><div class="sp-list"></div></section>`);
      $('.sp-manage', sec).onclick = () => { State.setPref('spLibFilter', 'playlist'); App.go('yourlib'); };
      for (const pl of pls.slice(0, 5)) {
        const el = html(`<div class="sp-lrow">${cover(State.playlistCover(pl), 'sp-row-cover')}<div class="sp-row-t"><b>${esc(pl.name)}</b><span>${plural(pl.items.length, 'song')} • ${esc(p.name)}</span></div><button class="sp-row-dots">${icon('dotsH', 20)}</button></div>`);
        el.onclick = (e) => (e.target.closest('.sp-row-dots') ? collectionSheet('pl:' + pl.id) : App.go('collection', 'pl:' + pl.id));
        el._spMenu = () => collectionSheet('pl:' + pl.id);
        $('.sp-list', sec).appendChild(el);
      }
      if (!pls.length) $('.sp-list', sec).appendChild(html('<div class="sp-noresults small"><span>No playlists yet.</span></div>'));
      const all = html(`<button class="sp-pill center">${pls.length ? 'See all playlists' : 'Create a playlist'}</button>`);
      all.onclick = () => (pls.length ? (State.setPref('spLibFilter', 'playlist'), App.go('yourlib')) : App.newPlaylist());
      sec.appendChild(all);
      root.appendChild(sec);
      const ta = topArtists().slice(0, 10);
      root.appendChild(shelf('Recently played artists', ta.map((a) => card({ title: a, sub: 'Artist', src: artistCover(a), round: true, onOpen: keyOpen('artist:' + a) }))));
    },
  };

  // ---------- playlist / album / mix page ----------
  const baseCollectionView = Views.collection;
  const collection = {
    render(root, key) {
      if (key && key.startsWith('artist:')) return artistPage(root, key.slice(7));
      const c = State.collection(key);
      if (!c) return baseCollectionView.render(root, key);
      const ids = c.items.map((i) => i.track.id);
      const total = c.items.reduce((s, i) => s + (i.track.duration || 0), 0);
      const ctx = { key, name: c.name };
      const playingHere = () => Player.isCurrentContext(key) && Player.playing;
      const pl = c.playlist;
      const head = html(`<div class="sp-coll-head">
        <div class="sp-coll-find"><div class="sp-sinput">${icon('search', 16)}<input type="search" placeholder="Find in ${esc(c.type.toLowerCase())}" /></div><button class="sp-pill sm sp-sortbtn">Sort</button></div>
        <div class="sp-coll-art">${cover(c.cover, 'sp-coll-cover')}</div>
        <h1 class="sp-coll-title">${esc(c.name)}</h1>
        ${c.description ? `<p class="sp-coll-desc">${esc(c.description)}</p>` : ''}
        <div class="sp-coll-owner">${c.type === 'Album' ? cover(artistCover(c.owner), 'sp-owner-av', true) : key.startsWith('pl:') || key === 'liked' ? SpotUI.avatar(22) : `<span class="sp-logo-mini">${icon('aurora', 22)}</span>`}<b>${esc(c.owner)}</b></div>
        <div class="sp-coll-meta">${c.type === 'Album' ? `Album • ${new Date(Math.max(...c.items.map((i) => i.addedAt || 0)) || Date.now()).getFullYear()}` : `${plural(c.items.length, c.items.some((i) => isVid(i.track)) ? 'item' : 'song')}`}${total ? ` • ${fmtLong(total)}` : ''}</div>
        <div class="sp-coll-actions">
          <div class="sp-ca-left">
            ${c.type === 'Album' || key.startsWith('mix:') ? `<button class="sp-icon-btn sp-ca-save">${icon(State.isPinned(key) ? 'addedCircle' : 'addCircle', 28)}</button>` : ''}
            <span class="sp-ca-dl sp-green">${icon('dl', 26)}</span>
            ${pl ? `<button class="sp-icon-btn sp-ca-add">${icon('userPlus', 26)}</button>` : ''}
            <button class="sp-icon-btn sp-ca-share">${icon('share', 24)}</button>
            <button class="sp-icon-btn sp-ca-more">${icon('dotsH', 24)}</button>
          </div>
          <div class="sp-ca-right"><button class="sp-icon-btn sp-ca-shuf ${Player.P.shuffle ? 'on' : ''}">${icon('shuffle', 28)}</button><button class="sp-bigplay" data-key="${esc(key)}">${icon(playingHere() ? 'pause' : 'play', 26)}</button></div>
        </div>
      </div>`);
      root.appendChild(head);
      SpotUI.colorOf(SpotUI.firstSrc(c.cover)).then((col) => { head.style.setProperty('--hc', col); });
      const list = html('<div class="sp-list sp-coll-list"></div>');
      root.appendChild(list);
      let q = '';
      const sortKey = () => ((State.prefs().sorts || {})[key]) || 'custom';
      const SORTS = { custom: 'Custom order', title: 'Title', artist: 'Artist', album: 'Album', added: 'Recently added' };
      const sorted = () => {
        const it = c.items.slice();
        const s = sortKey();
        const f = { title: (a, b) => a.track.title.localeCompare(b.track.title), artist: (a, b) => a.track.artist.localeCompare(b.track.artist), album: (a, b) => (a.track.album || '').localeCompare(b.track.album || ''), added: (a, b) => b.addedAt - a.addedAt }[s];
        if (f) it.sort(f);
        return it.filter((i) => !q || `${i.track.title} ${i.track.artist}`.toLowerCase().includes(q));
      };
      const draw = () => {
        list.innerHTML = '';
        const its = sorted();
        const order = its.map((i) => i.track.id);
        if (!c.items.length) {
          list.appendChild(html(`<div class="sp-empty small"><b>Let's start building your ${c.type.toLowerCase()}</b>${pl ? '<button class="sp-pill white sp-addsongs">Add to this playlist</button>' : ''}</div>`));
          const b = $('.sp-addsongs', list); if (b) b.onclick = () => addSongs(pl);
        }
        its.forEach((i, n) => list.appendChild(row(i.track, { playlistId: pl && pl.id, num: c.type === 'Album' ? n + 1 : 0, noCover: c.type === 'Album', play: () => playIds(ctx, order, n) })));
        if (pl && c.items.length) {
          const add = html(`<button class="sp-lrow sp-addrow"><span class="sp-plus-box">${icon('plus', 24)}</span><div class="sp-row-t"><b>Add to this playlist</b></div></button>`);
          add.onclick = () => addSongs(pl);
          list.appendChild(add);
          // recommended: other songs by the same artists
          const have = new Set(ids);
          const arts = [...new Set(c.items.map((i) => i.track.artist))];
          const rec = shuffle(tracks().filter((t) => !have.has(t.id) && (arts.includes(t.artist) || arts.some((a) => related(a).slice(0, 3).includes(t.artist))))).slice(0, 10);
          if (rec.length) {
            list.appendChild(html('<div class="sp-rec-head"><h2>Recommended</h2><span>Based on what\'s in this playlist</span></div>'));
            for (const t of rec) {
              const r = row(t, { dots: false, sub: esc(t.artist), play: () => playIds({ key: 'rec', name: 'Recommended' }, [t.id]) });
              const b = html(`<button class="sp-row-add">${icon('addCircle', 24)}</button>`);
              b.onclick = (e) => { e.stopPropagation(); State.addToPlaylist(pl.id, [t.id]); SpotUI.haptic('medium'); UI.toast(`Added to ${pl.name}`); r.remove(); };
              r.appendChild(b);
              list.appendChild(r);
            }
          }
        }
        if (c.type === 'Album' && c.items.length) {
          const more = albums().filter((a) => a.artist === c.owner && a.key !== key);
          if (more.length) list.appendChild(shelf(`More by ${c.owner}`, more.map((a) => card({ title: a.name, sub: 'Album', src: a.cover, onOpen: keyOpen(a.key) }))));
        }
      };
      draw();
      $('.sp-coll-find input', head).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); draw(); });
      $('.sp-sortbtn', head).onclick = () => SpotUI.sheet(Object.entries(SORTS).map(([k, l]) => ({ icon: 'sortArrows', label: l, on: sortKey() === k, action: () => { State.setPref('sorts', { ...(State.prefs().sorts || {}), [key]: k }); draw(); } })), { title: 'Sort by' });
      $('.sp-bigplay', head).onclick = () => { if (Player.isCurrentContext(key)) Player.toggle(); else playIds(ctx, sorted().map((i) => i.track.id), Player.P.shuffle ? -1 : 0); };
      $('.sp-ca-shuf', head).onclick = (e) => { Player.toggleShuffle(); e.currentTarget.classList.toggle('on', Player.P.shuffle); SpotUI.haptic('select'); };
      $('.sp-ca-share', head).onclick = () => SpotUI.share({ title: c.name, artist: c.owner });
      $('.sp-ca-more', head).onclick = () => collectionSheet(key);
      const save = $('.sp-ca-save', head); if (save) save.onclick = () => { State.togglePin(key); save.innerHTML = icon(State.isPinned(key) ? 'addedCircle' : 'addCircle', 28); UI.toast(State.isPinned(key) ? 'Saved to Your Library' : 'Removed from Your Library'); };
      const add = $('.sp-ca-add', head); if (add) add.onclick = () => addSongs(pl);
      const cv = $('.sp-coll-art', head); if (pl) cv.onclick = () => App.collectionMenu(key, innerWidth / 2, 200);
      const off = State.on('library', debounce(() => { if (App.current && App.current.param === key) App.render(false); }, 200));
      return () => { off(); };
    },
    live: false,
  };
  // pick songs from your library to add to a playlist
  function addSongs(pl) {
    const have = new Set(pl.items.map((i) => i.id));
    const all = tracks().filter((t) => !have.has(t.id)).sort((a, b) => b.addedAt - a.addedAt);
    const el = SpotUI.sheet([], { title: `Add to ${pl.name}`, cls: 'tall sp-picker' });
    const box = $('.sp-sheet-items', el);
    box.appendChild(html(`<div class="sp-sinput sp-pick-find">${icon('search', 18)}<input type="search" placeholder="Search your songs" /></div>`));
    const lst = html('<div></div>');
    box.appendChild(lst);
    const draw = (q = '') => {
      lst.innerHTML = '';
      for (const t of all.filter((x) => !q || `${x.title} ${x.artist}`.toLowerCase().includes(q)).slice(0, 150)) {
        const r = row(t, { dots: false, sub: esc(t.artist), play: () => {} });
        const b = html(`<button class="sp-row-add">${icon(have.has(t.id) ? 'addedCircle' : 'addCircle', 24)}</button>`);
        if (have.has(t.id)) b.classList.add('on');
        b.onclick = (e) => { e.stopPropagation(); if (have.has(t.id)) return; State.addToPlaylist(pl.id, [t.id]); have.add(t.id); b.innerHTML = icon('addedCircle', 24); b.classList.add('on'); SpotUI.haptic('medium'); };
        r.onclick = (e) => { if (!e.target.closest('.sp-row-add')) b.click(); };
        r.appendChild(b);
        lst.appendChild(r);
      }
    };
    $('input', box).addEventListener('input', (e) => draw(e.target.value.toLowerCase()));
    draw();
  }

  // ---------- artist page ----------
  function artistPage(root, name) {
    const ts = byArtist(name);
    if (!ts.length) return baseCollectionView.render(root, 'artist:' + name);
    const key = 'artist:' + name;
    const followed = () => State.isPinned(key);
    const popular = ts.slice().sort((a, b) => (plays(b.id) - plays(a.id)) || (State.isLiked(b.id) - State.isLiked(a.id)) || b.addedAt - a.addedAt);
    const totalPlays = ts.reduce((s, t) => s + plays(t.id), 0);
    const img = artistCover(name);
    const vids = ts.filter(isVid);
    const head = html(`<div class="sp-art-head">
      <div class="sp-art-img" style="background-image:url('${esc(img)}')"></div>
      <div class="sp-art-fade"></div>
      <div class="sp-art-name"><h1>${esc(name)}</h1><span class="sp-verified-line">${icon('checkCircle', 16)} In your library</span></div>
    </div>`);
    root.appendChild(head);
    const bar = html(`<div class="sp-art-body">
      <div class="sp-art-listeners">${plural(ts.length, ts.some(isVid) ? 'item' : 'song')} • ${plural(totalPlays, 'play')}</div>
      <div class="sp-coll-actions">
        <div class="sp-ca-left">${cover(UI.coverSrc(popular[0]), 'sp-art-thumb')}<button class="sp-pill sm sp-follow">${followed() ? 'Following' : 'Follow'}</button><button class="sp-icon-btn sp-ca-more">${icon('dotsH', 24)}</button></div>
        <div class="sp-ca-right"><button class="sp-icon-btn sp-ca-shuf ${Player.P.shuffle ? 'on' : ''}">${icon('shuffle', 28)}</button><button class="sp-bigplay" data-key="${esc(key)}">${icon(Player.isCurrentContext(key) && Player.playing ? 'pause' : 'play', 26)}</button></div>
      </div>
      <div class="sp-tabsbar"><button class="on" data-t="music">Music</button>${vids.length ? '<button data-t="clips">Videos</button>' : ''}<button data-t="about">About</button></div>
      <div class="sp-art-content"></div>
    </div>`);
    root.appendChild(bar);
    const content = $('.sp-art-content', bar);
    const ctx = { key, name };
    let showAll = false;
    const drawMusic = () => {
      content.innerHTML = '';
      content.appendChild(html('<h2 class="sp-h2">Popular</h2>'));
      const order = popular.map((t) => t.id);
      popular.slice(0, showAll ? 10 : 5).forEach((t, i) => content.appendChild(row(t, { num: i + 1, sub: `${State.isLiked(t.id) ? `<i class="sp-liked">${icon('addedCircle', 13)}</i>` : ''}${plays(t.id) ? plays(t.id).toLocaleString() + ' plays' : esc(t.album || (isVid(t) ? 'Video' : 'Song'))}`, play: () => playIds(ctx, order, i) })));
      if (popular.length > 5) { const b = html(`<button class="sp-pill center sm">${showAll ? 'Show less' : 'Show more'}</button>`); b.onclick = () => { showAll = !showAll; drawMusic(); }; content.appendChild(b); }
      const al = albums().filter((a) => a.artist === name).sort((a, b) => b.addedAt - a.addedAt);
      if (al.length) {
        const sec = html('<section class="sp-shelf"><div class="sp-shelf-head"><h2>Popular Releases</h2></div><div class="sp-list"></div></section>');
        al.slice(0, 4).forEach((a, i) => {
          const el = html(`<div class="sp-lrow sp-release">${cover(a.cover, 'sp-rel-cover')}<div class="sp-row-t">${i === 0 ? '<small>Latest release</small>' : ''}<b>${esc(a.name)}</b><span>Album • ${new Date(a.addedAt || Date.now()).getFullYear()}</span></div></div>`);
          el.onclick = keyOpen(a.key);
          $('.sp-list', sec).appendChild(el);
        });
        content.appendChild(sec);
      }
      const feat = State.playlists().filter((p) => p.items.some((i) => { const t = State.track(i.id); return t && t.artist === name; }));
      content.appendChild(shelf(`Featuring ${name}`, [
        card({ title: '', sub: `This is ${esc(name)}. The essential tracks, all in one place.`, src: img, label: `This Is ${name}`, labelColor: '#e91e63', onOpen: keyOpen('mix:' + name) }),
        ...feat.map((p) => card({ title: p.name, sub: esc(SpotUI.me().name), src: State.playlistCover(p), onOpen: keyOpen('pl:' + p.id) })),
      ]));
      content.appendChild(shelf(`${name} Radio`, [stationCard(name, 1)]));
      const fans = related(name).slice(0, 10);
      content.appendChild(shelf('Fans also like', fans.map((a) => card({ title: a, sub: 'Artist', src: artistCover(a), round: true, onOpen: keyOpen('artist:' + a) }))));
      content.appendChild(aboutCard());
    };
    const drawClips = () => {
      content.innerHTML = '';
      const grid = html('<div class="sp-clips"></div>');
      vids.forEach((t, i) => { const el = html(`<button class="sp-clip">${cover(UI.coverSrc(t), 'sp-clip-cover')}<b>${esc(t.title)}</b></button>`); el.onclick = () => { playIds({ key, name }, vids.map((x) => x.id), i); SpotPlayer.open(); }; grid.appendChild(el); });
      content.appendChild(grid);
    };
    const aboutCard = () => {
      const first = Math.min(...ts.map((t) => t.addedAt || Date.now()));
      const liked = ts.filter((t) => State.isLiked(t.id)).length;
      const rank = topArtists().indexOf(name) + 1;
      const el = html(`<section class="sp-about"><h2 class="sp-h2">About</h2><div class="sp-about-card"><div class="sp-about-img" style="background-image:url('${esc(img)}')"></div><div class="sp-about-text">${rank ? `<small>#${rank} in your top artists</small>` : ''}<b>${esc(name)} <span class="sp-verified">${icon('checkCircle', 15)}</span></b><span>${plural(ts.length, 'item')} in your library • ${plural(liked, 'favorite')}</span><p>In your library since ${esc(fmtDate(first))}. ${totalPlays ? `You've played ${name} ${plural(totalPlays, 'time')}.` : 'Play something to start your stats.'}</p></div></div></section>`);
      return el;
    };
    const tabs = $$('.sp-tabsbar button', bar);
    tabs.forEach((b) => b.onclick = () => { tabs.forEach((x) => x.classList.toggle('on', x === b)); ({ music: drawMusic, clips: drawClips, about: () => { content.innerHTML = ''; content.appendChild(aboutCard()); } })[b.dataset.t](); });
    drawMusic();
    $('.sp-follow', bar).onclick = (e) => { State.togglePin(key); e.currentTarget.textContent = followed() ? 'Following' : 'Follow'; SpotUI.haptic('medium'); };
    $('.sp-ca-more', bar).onclick = () => collectionSheet(key);
    $('.sp-ca-shuf', bar).onclick = (e) => { Player.toggleShuffle(); e.currentTarget.classList.toggle('on', Player.P.shuffle); };
    $('.sp-bigplay', bar).onclick = () => { if (Player.isCurrentContext(key)) Player.toggle(); else playIds(ctx, popular.map((t) => t.id), Player.P.shuffle ? -1 : 0); };
    // the big name shrinks into the top bar as you scroll
    const sc = $('#main-scroll');
    const onScroll = () => document.body.classList.toggle('sp-art-scrolled', sc.scrollTop > 230);
    sc.addEventListener('scroll', onScroll, { passive: true });
    $('#sp-back') && ($('#sp-back').dataset.title = name);
    return () => { sc.removeEventListener('scroll', onScroll); document.body.classList.remove('sp-art-scrolled'); };
  }

  // ---------- Listening stats ----------
  const spstats = {
    render(root) {
      const h = history();
      const since = Date.now() - 28 * 864e5;
      const recent = h.filter((x) => x.at >= since);
      const useAll = recent.length < 5;
      const src = useAll ? null : recent;
      const count = new Map();
      if (src) for (const x of src) count.set(x.id, (count.get(x.id) || 0) + 1);
      else for (const t of tracks()) if (plays(t.id)) count.set(t.id, plays(t.id));
      const topT = [...count.entries()].map(([id, n]) => [State.track(id), n]).filter(([t]) => t).sort((a, b) => b[1] - a[1]);
      const artC = new Map();
      for (const [t, n] of topT) artC.set(t.artist, (artC.get(t.artist) || 0) + n);
      const topA = [...artC.entries()].sort((a, b) => b[1] - a[1]);
      const minutes = Math.round(topT.reduce((s, [t, n]) => s + (t.duration || 0) * n, 0) / 60);
      root.appendChild(html(`<div class="sp-page-head"><h1>Listening stats</h1><span>${useAll ? 'All time' : 'Past 4 weeks'}</span></div>`));
      root.appendChild(html(`<div class="sp-stat-cards"><div><b>${minutes.toLocaleString()}</b><span>minutes listened</span></div><div><b>${topT.reduce((s, [, n]) => s + n, 0).toLocaleString()}</b><span>plays</span></div><div><b>${artC.size}</b><span>artists</span></div></div>`));
      if (!topT.length) { root.appendChild(html('<div class="sp-noresults"><b>No stats yet</b><span>Play some music and come back to see your top artists and songs.</span></div>')); return; }
      root.appendChild(shelf('Top artists', topA.slice(0, 10).map(([a, n], i) => card({ title: `${i + 1}. ${a}`, sub: plural(n, 'play'), src: artistCover(a), round: true, onOpen: keyOpen('artist:' + a) }))));
      root.appendChild(html('<h2 class="sp-h2">Top songs</h2>'));
      const order = topT.slice(0, 25).map(([t]) => t.id);
      topT.slice(0, 25).forEach(([t, n], i) => root.appendChild(row(t, { num: i + 1, sub: `${esc(t.artist)} • ${plural(n, 'play')}`, play: () => playIds({ key: 'stats', name: 'Your top songs' }, order, i) })));
    },
  };

  // ---------- Recents ----------
  const sprecents = {
    render(root) {
      root.appendChild(html('<div class="sp-page-head"><h1>Recents</h1><span>What you played lately</span></div>'));
      const rec = recentTracks(200);
      if (!rec.length) { root.appendChild(html('<div class="sp-noresults"><b>Nothing played yet</b><span>Songs you play show up here.</span></div>')); return; }
      let day = '';
      const order = rec.map((x) => x.t.id);
      rec.forEach(({ t, at }, i) => {
        const d = new Date(at);
        const label = new Date().toDateString() === d.toDateString() ? 'Today' : new Date(Date.now() - 864e5).toDateString() === d.toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
        if (label !== day) { day = label; root.appendChild(html(`<h2 class="sp-h2 sp-day">${esc(label)}</h2>`)); }
        root.appendChild(row(t, { type: isVid(t) ? 'Video' : 'Song', play: () => playIds({ key: 'recents', name: 'Recents' }, order, i) }));
      });
    },
  };

  // ---------- Your Updates ----------
  function updates() {
    const u = typeof Updates !== 'undefined' ? Updates.state || {} : {};
    const ver = window.AURORA_IOS_VERSION || '';
    SpotUI.sheet([
      { icon: 'megaphone', label: `Aurora for iPhone ${ver}`, sub: 'Full-speed downloads, Aurora Account, silent endings cut, and this new layout.', action: () => {} },
      { icon: 'refresh', label: u.phase === 'available' ? 'A new version is available' : 'Check for updates', sub: 'Updates are installed with Sideloadly', action: () => (Updates.onClick ? Updates.onClick() : Updates.open()) },
      { icon: 'github', label: 'Release notes on GitHub', action: () => native.shell.openExternal('https://github.com/UndeadBossGames/Aurora-iOS/releases') },
    ], { title: 'Your Updates' });
  }

  // a long press anywhere on an item with a menu
  (function longPress() {
    let lp = null;
    document.addEventListener('touchstart', (e) => {
      const el = e.target.closest('.sp-row, .sp-lrow, .sp-lgrid, .sp-sc');
      if (!el || !el._spMenu || e.touches.length > 1) return;
      const t = e.touches[0];
      lp = { x: t.clientX, y: t.clientY, timer: setTimeout(() => { lp.fired = true; el._spMenu(); }, 450) };
    }, { passive: true });
    const cancel = (e) => {
      if (!lp) return;
      if (e.type === 'touchmove') { const t = e.touches[0]; if (Math.hypot(t.clientX - lp.x, t.clientY - lp.y) < 10) return; }
      clearTimeout(lp.timer);
      if (lp.fired && e.type === 'touchend') e.preventDefault();
      lp = null;
    };
    document.addEventListener('touchmove', cancel, { passive: true });
    document.addEventListener('touchend', cancel, { passive: false });
    document.addEventListener('contextmenu', (e) => { const el = e.target.closest('.sp-row, .sp-lrow, .sp-lgrid, .sp-sc'); if (el && el._spMenu) { e.preventDefault(); e.stopPropagation(); el._spMenu(); } }, true);
  })();

  // keep the "now playing" highlight in lists up to date
  function markPlaying() {
    const id = Player.current && Player.current.id;
    $$('.sp-row').forEach((r) => r.classList.toggle('playing', r.dataset.id === id));
    $$('.sp-bigplay[data-key]').forEach((b) => { const on = Player.isCurrentContext(b.dataset.key) && Player.playing; if (b.dataset.on !== String(on)) { b.dataset.on = on; b.innerHTML = icon(on ? 'pause' : 'play', 26); } });
  }

  function install() {
    Object.assign(Views, { home, search, yourlib, collection, spstats, sprecents });
    Views.profile = Object.assign(Object.create(baseProfile), baseProfile, { render: profile.render });
    Player.on('track', markPlaying);
    Player.on('state', markPlaying);
  }

  return { install, focusSearch, playRadio, albums, topArtists, artistCover, updates, collectionSheet, mixIds, related, row };
})();
