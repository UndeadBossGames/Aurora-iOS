// Aurora for iPhone: connected apps.
//  - Last.fm: scrobbles what you play (also songs played while the app was closed), shows
//    "now playing" on your profile, and gives the AI DJ facts about songs. Needs your own free
//    Last.fm API key (last.fm/api/account/create), then one tap to approve Aurora on Last.fm.
//  - stats.fm: your public stats.fm profile's top songs and artists inside Listening stats, with
//    one tap to download any you don't have yet (explicit version first).
const Connect = (() => {
  const Cap = window.Capacitor || {};
  const Http = (Cap.Plugins || {}).CapacitorHttp;
  const S = () => State.settings();
  const LF = 'https://ws.audioscrobbler.com/2.0/';

  // ---------------------------------------------------------------- MD5 (Last.fm request signatures)
  function md5(str) {
    const b = new TextEncoder().encode(str);
    const n = ((b.length + 8) >> 6) + 1, w = new Uint32Array(n * 16);
    for (let i = 0; i < b.length; i++) w[i >> 2] |= b[i] << ((i % 4) * 8);
    w[b.length >> 2] |= 0x80 << ((b.length % 4) * 8);
    w[n * 16 - 2] = b.length * 8;
    const K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
    const R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let o = 0; o < w.length; o += 16) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const s = R[(i >> 4) * 4 + (i % 4)];
        const x = (A + F + K[i] + w[o + g]) | 0;
        A = D; D = C; C = B; B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((k) => ((v >>> k) & 255).toString(16).padStart(2, '0')).join('')).join('');
  }

  // ---------------------------------------------------------------- Last.fm API
  const lf = () => ({ key: String(S().lfKey || '').trim(), secret: String(S().lfSecret || '').trim(), session: S().lfSession || null });
  const lfReady = () => !!lf().key;
  const lfLinked = () => !!(lf().key && lf().secret && lf().session && lf().session.key);
  function sign(params) {
    const keys = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort();
    return md5(keys.map((k) => k + params[k]).join('') + lf().secret);
  }
  async function lfCall(method, params = {}, { signed = false, post = false } = {}) {
    const p = { method, api_key: lf().key, ...params };
    if (signed) { if (lf().session && lf().session.key && !p.token) p.sk = lf().session.key; p.api_sig = sign(p); }
    p.format = 'json';
    const qs = Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    let data;
    if (Http) {
      const r = post
        ? await Http.post({ url: LF, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: qs })
        : await Http.get({ url: `${LF}?${qs}` });
      data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    } else {
      const r = post ? await fetch(LF, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs }) : await fetch(`${LF}?${qs}`);
      data = await r.json();
    }
    if (data && data.error) throw Object.assign(new Error(data.message || 'Last.fm error ' + data.error), { code: data.error });
    return data;
  }

  // ---------------------------------------------------------------- scrobbling
  const SC = { id: null, startedAt: 0, played: 0, resumedAt: 0, done: false, track: null };
  const queue = () => State.prefs().lfQueue || [];
  function startTrack(t) {
    finishTrack();
    Object.assign(SC, { id: t ? t.id : null, track: t, startedAt: Date.now(), played: 0, resumedAt: Player.playing ? Date.now() : 0, done: false });
    if (t && lfLinked() && S().lfScrobble !== false && (t.duration || 60) > 30) {
      lfCall('track.updateNowPlaying', { artist: t.artist, track: t.title, ...(t.album ? { album: t.album } : {}), ...(t.duration ? { duration: Math.round(t.duration) } : {}) }, { signed: true, post: true }).catch(() => {});
    }
  }
  function elapsed(now = Date.now()) { return SC.played + (SC.resumedAt ? (now - SC.resumedAt) / 1000 : 0); }
  function maybeScrobble(now = Date.now()) {
    const t = SC.track;
    if (!t || SC.done || !lfLinked() || S().lfScrobble === false) return;
    const dur = t.duration || 0;
    if (dur && dur < 30) return;
    if (elapsed(now) >= Math.min(240, dur ? dur / 2 : 240)) {
      SC.done = true;
      const q = queue().concat([{ artist: t.artist, track: t.title, album: t.album || '', duration: Math.round(dur || 0), timestamp: Math.floor(SC.startedAt / 1000) }]).slice(-500);
      State.setPref('lfQueue', q);
      flush();
    }
  }
  function finishTrack() {
    // songs that changed while the app was closed: the native engine says when it moved on
    const adv = typeof NativeAudio !== 'undefined' && NativeAudio.state && NativeAudio.state.advAt;
    maybeScrobble(adv && adv > SC.startedAt ? adv : Date.now());
  }
  let flushing = false;
  async function flush() {
    if (flushing || !lfLinked() || !queue().length) return;
    flushing = true;
    try {
      while (queue().length) {
        const batch = queue().slice(0, 50);
        const p = {};
        batch.forEach((s, i) => { p[`artist[${i}]`] = s.artist; p[`track[${i}]`] = s.track; p[`timestamp[${i}]`] = s.timestamp; if (s.album) p[`album[${i}]`] = s.album; if (s.duration) p[`duration[${i}]`] = s.duration; });
        await lfCall('track.scrobble', p, { signed: true, post: true });
        State.setPref('lfQueue', queue().slice(batch.length));
        State.setPref('lfCount', (State.prefs().lfCount || 0) + batch.length);
      }
    } catch (e) {
      if (e.code === 9) { State.setSetting('lfSession', null); UI.toast('Last.fm disconnected. Connect it again in Personalize.'); }
    } finally { flushing = false; }
  }

  // ---------------------------------------------------------------- facts for the DJ
  const factCache = new Map();
  async function trackFacts(t) {
    if (!lfReady() || !t) return null;
    const k = `${t.artist}|${t.title}`.toLowerCase();
    if (factCache.has(k)) return factCache.get(k);
    let f = null;
    try {
      const d = await lfCall('track.getInfo', { artist: t.artist, track: String(t.title).replace(/\s*[([][^)\]]*(official|video|audio|lyric)[^)\]]*[)\]]/gi, ''), autocorrect: 1 });
      const tr = d.track || {};
      const summary = firstSentence((tr.wiki && tr.wiki.summary) || '');
      const tag = ((tr.toptags && tr.toptags.tag) || []).map((x) => x.name).find((n) => /^[a-z][a-z -]{2,18}$/i.test(n) && !/seen live|favorite|spotify/i.test(n));
      f = { listeners: +tr.listeners || 0, plays: +tr.playcount || 0, summary, tag: tag ? tag.toLowerCase() : '' };
      if (!f.summary && t.artist) {
        const a = await lfCall('artist.getInfo', { artist: t.artist, autocorrect: 1 }).catch(() => null);
        const bio = a && a.artist && a.artist.bio && firstSentence(a.artist.bio.summary || '');
        if (bio && Math.random() < 0.5) f.summary = bio;
      }
    } catch {}
    factCache.set(k, f);
    return f;
  }
  function firstSentence(html) {
    const txt = String(html).replace(/<a [^>]*>Read more on Last\.fm<\/a>\.?/i, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const m = txt.match(/^(.{30,220}?[.!?])(\s|$)/);
    return m && !/User-contributed|Creative Commons/i.test(m[1]) ? m[1] : '';
  }

  // ---------------------------------------------------------------- stats.fm
  const sfUser = () => String(S().sfUser || '').trim().replace(/^@/, '').replace(/^https?:\/\/stats\.fm\/(user\/)?/i, '');
  const sfCache = new Map();
  async function sf(path) {
    const url = `https://api.stats.fm/api/v1/users/${encodeURIComponent(sfUser())}${path}`;
    if (sfCache.has(url) && Date.now() - sfCache.get(url).at < 10 * 6e4) return sfCache.get(url).data;
    const r = Http ? await Http.get({ url, headers: { Accept: 'application/json' } }) : { status: 200, data: await (await fetch(url)).json() };
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (r.status >= 400 || (d && d.message && !d.items && !d.item)) throw new Error(r.status === 404 ? 'No stats.fm user with that name' : (d && d.message) || 'stats.fm error');
    sfCache.set(url, { at: Date.now(), data: d });
    return d;
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/[^a-z0-9]+/g, '');
  const inLibrary = (title, artist) => State.allTracks().find((t) => norm(t.title).includes(norm(title)) && (!artist || norm(t.artist).includes(norm(artist).slice(0, 6)) || norm(t.title).includes(norm(artist).slice(0, 6))));
  async function download(title, artist, cover, explicit) {
    let url = `ytsearch1:${artist ? artist + ' - ' : ''}${title} audio`, meta = { title, artist, cover, explicit: explicit || undefined };
    if (typeof discoverOfficialSong === 'function') {
      const off = await discoverOfficialSong(title, artist).catch(() => null);
      if (off) { url = off.url; meta = { ...meta, album: off.album || undefined, explicit: off.explicit || explicit || undefined }; }
    }
    await native.dl.add({ url, format: 'audio-mp3', addToLibrary: true, meta });
    UI.toast(`Downloading "${title}"`);
  }

  function statsSection() {
    const box = html('<section class="cx-stats"></section>');
    const st = { range: State.prefs().sfRange || 'weeks' };
    async function draw() {
      box.innerHTML = '';
      if (!sfUser()) {
        const c = html(`<button class="cx-connect"><span class="cx-logo sf">${icon('stats', 22)}</span><span><b>Add your stats.fm</b><small>See your top songs and artists from stats.fm here</small></span>${icon('chevronRight', 18)}</button>`);
        c.onclick = statsfmSheet;
        box.appendChild(c);
        return;
      }
      box.appendChild(html(`<div class="cx-head"><div><h2>stats.fm</h2><span>@${esc(sfUser())}</span></div><button class="sdl-text-btn cx-edit">Change</button></div>`));
      $('.cx-edit', box).onclick = statsfmSheet;
      const chips = html('<div class="sdl-r-chips"><button class="sp-chip" data-r="weeks">4 weeks</button><button class="sp-chip" data-r="months">6 months</button><button class="sp-chip" data-r="lifetime">All time</button></div>');
      $$('button', chips).forEach((b) => { b.classList.toggle('on', b.dataset.r === st.range); b.onclick = () => { st.range = b.dataset.r; State.setPref('sfRange', st.range); draw(); }; });
      box.appendChild(chips);
      const list = html('<div class="cx-list"><div class="cx-skel"></div><div class="cx-skel"></div><div class="cx-skel"></div></div>');
      box.appendChild(list);
      try {
        const [tracks, artists] = await Promise.all([sf(`/top/tracks?range=${st.range}&limit=20`), sf(`/top/artists?range=${st.range}&limit=12`).catch(() => ({ items: [] }))]);
        list.innerHTML = '';
        if (artists.items && artists.items.length) {
          const row = html('<div class="cx-artists"></div>');
          artists.items.forEach((x) => { const a = x.artist || {}; const b = html(`<button class="cx-artist"><span style="background-image:url('${esc(a.image || '')}')"></span><b>${esc(a.name || '')}</b><small>${x.streams ? `${x.streams} plays` : ''}</small></button>`); b.onclick = () => { const has = State.allTracks().some((t) => t.artist === a.name); if (has) App.go('collection', 'artist:' + a.name); else SpotViews.focusSearch(a.name); }; row.appendChild(b); });
          list.appendChild(row);
        }
        (tracks.items || []).forEach((x, i) => {
          const t = x.track || {}, artist = (t.artists || []).map((a) => a.name).join(', '), cover = ((t.albums || [])[0] || {}).image || '';
          const have = inLibrary(t.name, (t.artists || [])[0] && t.artists[0].name);
          const r = html(`<div class="cx-track">
            <span class="cx-n">${i + 1}</span><img src="${esc(cover)}" alt="" />
            <div class="cx-t"><b>${esc(t.name || '')}</b><span>${t.explicit ? '<i class="explicit">E</i>' : ''}${esc(artist)}${x.streams ? ` · ${x.streams} plays` : ''}</span></div>
            <button class="cx-dl ${have ? 'have' : ''}" aria-label="${have ? 'Play' : 'Download'}">${icon(have ? 'play' : 'dlOutline', have ? 18 : 24)}</button>
          </div>`);
          $('.cx-dl', r).onclick = async (e) => {
            e.stopPropagation();
            if (have) return Player.playContext({ key: 'statsfm', name: 'stats.fm' }, [have.id], 0);
            SpotUI.haptic('medium');
            e.currentTarget.classList.add('busy');
            try { await download(t.name, (t.artists || [])[0] && t.artists[0].name, cover, t.explicit); } catch (err) { UI.toast(String(err.message || err)); }
          };
          list.appendChild(r);
        });
        if (!(tracks.items || []).length) list.appendChild(html('<div class="sp-noresults small"><span>No stats for this period. Is your stats.fm profile public?</span></div>'));
      } catch (e) {
        list.innerHTML = `<div class="sp-noresults small"><span>${esc(e.message || 'Couldn\'t load stats.fm')}</span></div>`;
      }
    }
    draw();
    return box;
  }

  function lastfmSection() {
    if (!lfLinked()) return null;
    const box = html(`<section class="cx-stats"><div class="cx-head"><div><h2>Last.fm</h2><span>@${esc(lf().session.name)} · ${State.prefs().lfCount || 0} scrobbled from Aurora</span></div></div><div class="cx-list"></div></section>`);
    lfCall('user.getTopArtists', { user: lf().session.name, period: '7day', limit: 10 }).then((d) => {
      const list = $('.cx-list', box);
      const items = (d.topartists && d.topartists.artist) || [];
      if (!items.length) { list.innerHTML = '<div class="sp-noresults small"><span>No scrobbles this week yet.</span></div>'; return; }
      list.appendChild(html(`<div class="sp-h2-sub">Your top artists this week</div>`));
      items.forEach((a, i) => list.appendChild(html(`<div class="cx-track"><span class="cx-n">${i + 1}</span><img src="${esc(SpotViews.artistCover(a.name))}" alt="" class="round" /><div class="cx-t"><b>${esc(a.name)}</b><span>${a.playcount} scrobbles</span></div></div>`)));
    }).catch(() => {});
    return box;
  }

  // ---------------------------------------------------------------- connect sheets
  function sheetWith(title, body) {
    const sh = SpotUI.sheet([], { title });
    $('.sp-sheet-items', sh).appendChild(body);
    return sh;
  }
  function lastfmSheet() {
    const s = S();
    if (lfLinked()) {
      SpotUI.sheet([
        { icon: 'check', label: `Connected as ${lf().session.name}`, sub: `${State.prefs().lfCount || 0} songs scrobbled from Aurora` },
        { icon: 'refresh', label: s.lfScrobble === false ? 'Turn scrobbling on' : 'Pause scrobbling', sub: 'Keep the connection, stop sending plays', action: () => { State.setSetting('lfScrobble', s.lfScrobble === false); UI.toast(S().lfScrobble === false ? 'Scrobbling paused' : 'Scrobbling on'); } },
        { icon: 'external', label: 'Open my Last.fm profile', action: () => native.shell.openExternal(`https://www.last.fm/user/${encodeURIComponent(lf().session.name)}`) },
        { icon: 'close', label: 'Disconnect Last.fm', danger: true, action: () => { State.setSetting('lfSession', null); UI.toast('Last.fm disconnected'); } },
      ], { title: 'Last.fm' });
      return;
    }
    const body = html(`<div class="cx-form">
      <ol class="cx-steps">
        <li><b>Create a free Last.fm API account</b><span>Any name works, for example "Aurora". Leave the callback URL empty.</span><button class="sp-pill sm cx-create">Open last.fm/api</button></li>
        <li><b>Paste your API key and shared secret</b>
          <input class="cx-in cx-key" placeholder="API key" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(s.lfKey || '')}" />
          <input class="cx-in cx-secret" placeholder="Shared secret" type="password" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(s.lfSecret || '')}" /></li>
        <li><b>Allow Aurora on Last.fm</b><span>Tap Connect, press "Yes, allow access" on the Last.fm page, then come back here.</span></li>
      </ol>
      <button class="sdl-go cx-go">Connect</button>
      <p class="cx-note">Your key, secret and Last.fm session stay on this iPhone.</p>
    </div>`);
    const sh = sheetWith('Connect Last.fm', body);
    $('.cx-create', body).onclick = () => native.shell.openExternal('https://www.last.fm/api/account/create');
    const go = $('.cx-go', body);
    let token = null;
    go.onclick = async () => {
      const key = $('.cx-key', body).value.trim(), secret = $('.cx-secret', body).value.trim();
      if (!key || !secret) return UI.toast('Paste both the API key and the shared secret');
      State.setSetting('lfKey', key); State.setSetting('lfSecret', secret);
      go.disabled = true;
      try {
        if (!token) {
          token = (await lfCall('auth.getToken', {}, { signed: true })).token;
          native.shell.openExternal(`https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`);
          go.textContent = "I've allowed Aurora";
          go.disabled = false;
          return;
        }
        const d = await lfCall('auth.getSession', { token }, { signed: true });
        State.setSetting('lfSession', { name: d.session.name, key: d.session.key });
        SpotUI.closeSheet();
        UI.toast(`Last.fm connected as ${d.session.name}`);
        flush();
      } catch (e) {
        go.disabled = false;
        if (e.code === 14) UI.toast('Press "Yes, allow access" on Last.fm first, then tap again');
        else { token = null; go.textContent = 'Connect'; UI.toast(e.code === 10 || e.code === 26 ? 'That API key doesn\'t look right' : e.code === 13 ? 'The shared secret doesn\'t match the key' : String(e.message || e)); }
      }
    };
    return sh;
  }
  function statsfmSheet() {
    const body = html(`<div class="cx-form">
      <p class="cx-note">stats.fm shows your Spotify or Apple Music listening stats. Enter your stats.fm username (in the stats.fm app: Profile → Share). Your profile needs to be public.</p>
      <input class="cx-in cx-user" placeholder="stats.fm username" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(S().sfUser || '')}" />
      <button class="sdl-go cx-go">Save</button>
      ${S().sfUser ? '<button class="sp-pill sm cx-remove">Remove stats.fm</button>' : ''}
    </div>`);
    sheetWith('stats.fm', body);
    $('.cx-go', body).onclick = async () => {
      const u = $('.cx-user', body).value.trim();
      State.setSetting('sfUser', u);
      sfCache.clear();
      if (u) { try { await sf('/top/tracks?range=weeks&limit=1'); UI.toast('stats.fm added'); } catch (e) { UI.toast(e.message); } }
      SpotUI.closeSheet();
      if (App.current && ['spstats', 'personalize'].includes(App.current.view)) App.render(true);
    };
    const rm = $('.cx-remove', body); if (rm) rm.onclick = () => { State.setSetting('sfUser', ''); SpotUI.closeSheet(); if (App.current && ['spstats', 'personalize'].includes(App.current.view)) App.render(true); };
  }
  function settingsSection() {
    const el = html(`<section class="pz-sec"><h2>Connected apps</h2><div class="pz-list">
      <button class="pz-row cx-lf"><span class="cx-rowt"><span class="cx-logo lf">fm</span><span><b>Last.fm</b><small>${lfLinked() ? `Scrobbling as ${esc(lf().session.name)}` : 'Scrobble your plays, and give the DJ song facts'}</small></span></span>${icon('chevronRight', 18)}</button>
      <button class="pz-row cx-sf"><span class="cx-rowt"><span class="cx-logo sf">${icon('stats', 18)}</span><span><b>stats.fm</b><small>${sfUser() ? `@${esc(sfUser())} · in Listening stats` : 'Your top songs and artists, in Listening stats'}</small></span></span>${icon('chevronRight', 18)}</button>
    </div></section>`);
    $('.cx-lf', el).onclick = lastfmSheet;
    $('.cx-sf', el).onclick = statsfmSheet;
    return el;
  }

  function install() {
    if (typeof Personalize !== 'undefined') Personalize.addSection(settingsSection);
    // Listening stats: stats.fm and Last.fm sections at the end
    const st = Views.spstats;
    if (st && !st.__cx) {
      const r = st.render;
      Views.spstats = Object.assign(Object.create(st), st, { __cx: true, render(root, ...a) { const out = r.call(this, root, ...a); root.appendChild(statsSection()); const l = lastfmSection(); if (l) root.appendChild(l); return out; } });
    }
    // scrobbling
    Player.on('track', (t) => startTrack(t || Player.current));
    Player.media.addEventListener('play', () => { if (!SC.resumedAt) SC.resumedAt = Date.now(); });
    Player.media.addEventListener('pause', () => { if (SC.resumedAt) { SC.played += (Date.now() - SC.resumedAt) / 1000; SC.resumedAt = 0; } maybeScrobble(); });
    Player.media.addEventListener('seeked', () => { /* skipping around still counts what was heard */ });
    setInterval(() => maybeScrobble(), 10000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
    setTimeout(flush, 4000);
  }

  return { install, trackFacts, md5, lfCall, get lastfm() { return lfLinked(); }, statsfmSheet, lastfmSheet };
})();
