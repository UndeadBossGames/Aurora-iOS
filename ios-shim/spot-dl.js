// Aurora for iPhone, standard layout: the Downloader page, built for the phone.
// Paste a link (or tap the clipboard chip), see what it is, pick Song or Video, download.
// Live cards for downloads in progress, clear reasons + Retry for failures, and everything you've
// downloaded grouped by day. Uses the same engine and job list as the classic page (DL, native.dl).
const SpotDL = (() => {
  const ios = () => window.native && native.platform === 'ios';
  const Http = ((window.Capacitor || {}).Plugins || {}).CapacitorHttp;
  const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());
  const MUSIC_SITES = /soundcloud\.com|spotify\.com|bandcamp\.com|music\.youtube\.com|mixcloud\.com|audiomack\.com/i;
  const LIST_LINK = /[?&]list=|\/playlist|\/sets\/|\/album\/|spotify\.com\/(intl-[a-z-]+\/)?(album|playlist|artist)/i;
  const ACTIVE = ['queued', 'downloading', 'preparing'];
  const FAILED = ['error', 'cancelled'];

  function sourceOf(url) {
    const map = [[/music\.youtube/i, 'YouTube Music', '#ff0033'], [/youtube\.com|youtu\.be/i, 'YouTube', '#ff0033'], [/soundcloud/i, 'SoundCloud', '#ff5500'], [/spotify/i, 'Spotify', '#1ed760'],
      [/tiktok/i, 'TikTok', '#25f4ee'], [/instagram/i, 'Instagram', '#e1306c'], [/twitter\.com|x\.com/i, 'X', '#e7e9ea'], [/vimeo/i, 'Vimeo', '#1ab7ea'], [/bandcamp/i, 'Bandcamp', '#629aa9'],
      [/twitch/i, 'Twitch', '#9146ff'], [/facebook|fb\.watch/i, 'Facebook', '#1877f2'], [/reddit/i, 'Reddit', '#ff4500'], [/mixcloud/i, 'Mixcloud', '#5000ff'], [/dailymotion/i, 'Dailymotion', '#0d65f2']];
    for (const [re, name, color] of map) if (re.test(url)) return { name, color };
    try { return { name: new URL(url).hostname.replace(/^www\./, ''), color: '#b3b3b3' }; } catch { return { name: 'Web', color: '#b3b3b3' }; }
  }
  const ytId = (u) => (String(u).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/) || [])[1];

  // what's behind a link: title, author and picture (oEmbed, no download needed)
  const peekCache = new Map();
  async function peek(url) {
    if (peekCache.has(url)) return peekCache.get(url);
    const src = sourceOf(url);
    let api = null;
    if (/youtube\.com|youtu\.be/i.test(url)) api = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url);
    else if (/soundcloud\.com/i.test(url)) api = 'https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(url);
    else if (/spotify\.com/i.test(url)) api = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(url);
    else if (/vimeo\.com/i.test(url)) api = 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(url);
    else if (/tiktok\.com/i.test(url)) api = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url);
    let info = { source: src, title: '', author: '', thumb: ytId(url) ? `https://i.ytimg.com/vi/${ytId(url)}/hqdefault.jpg` : '' };
    if (api) {
      try {
        const r = Http ? await Http.get({ url: api, headers: { Accept: 'application/json' } }) : { data: await (await fetch(api)).json() };
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (d && (d.title || d.author_name)) info = { ...info, title: d.title || '', author: d.author_name || '', thumb: info.thumb || d.thumbnail_url || '' };
      } catch {}
    }
    peekCache.set(url, info);
    return info;
  }

  const fmtOf = (s) => s.dlFormat || 'video-best';
  const kindOf = (f) => (String(f).startsWith('audio') ? 'song' : 'video');

  // ---------------------------------------------------------------- page
  const view = {
    live: false,
    render(root, prefill) {
      dlBind();
      const s = State.settings();
      let kind = kindOf(fmtOf(s));
      let quality = /video-(1080|720)/.test(fmtOf(s)) ? fmtOf(s) : 'video-best';
      const el = html(`<div class="sdl">
        <div class="sdl-hero">
          <div class="sdl-glow"></div>
          <h1>Downloader</h1>
          <p>Save songs and videos from YouTube, SoundCloud, TikTok and 1000+ sites.</p>
          <div class="sdl-input">
            ${icon('link', 20)}
            <input type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste a link" enterkeyhint="go" />
            <button class="sdl-clear" hidden aria-label="Clear">${icon('close', 16)}</button>
          </div>
          <button class="sdl-paste">${icon('paste', 16)}<span>Paste from clipboard</span></button>
          <div class="sdl-preview" hidden></div>
          <div class="sdl-kinds">
            <button data-k="song"><span class="sdl-k-ic">${icon('music', 26)}</span><b>Song</b><small>Audio · .m4a</small></button>
            <button data-k="video"><span class="sdl-k-ic">${icon('video', 26)}</span><b>Video</b><small>Video · .mp4</small></button>
          </div>
          <div class="sdl-quality">
            <span>Quality</span>
            <div class="sdl-q-chips"><button data-q="video-best">Best</button><button data-q="video-1080">1080p</button><button data-q="video-720">720p</button></div>
          </div>
          <label class="sdl-switch sdl-pl" hidden><span><b>Whole playlist or album</b><small>Every item downloads at the same time</small></span><input type="checkbox" class="toggle" ${s.dlPlaylist ? 'checked' : ''} /></label>
          <button class="sdl-go" disabled>${icon('download', 20)}<span>Download</span></button>
          <button class="sdl-search">${icon('search', 16)}<span>No link? Search songs and videos</span>${icon('chevronRight', 16)}</button>
        </div>
        <section class="sdl-sec sdl-active" hidden><h2>Downloading <em></em></h2><div class="sdl-cards"></div></section>
        <section class="sdl-sec sdl-failed" hidden><div class="sdl-sec-head"><h2>Couldn't download <em></em></h2><button class="sdl-text-btn sdl-retry-all">Retry all</button></div><div class="sdl-cards"></div></section>
        <section class="sdl-sec sdl-recent"></section>
        <section class="sdl-engine"></section>
      </div>`);
      root.appendChild(el);
      const $e = (q) => $(q, el);
      const input = $e('.sdl-input input');
      const go = $e('.sdl-go');
      const pl = $e('.sdl-pl');

      // ----- link box -----
      let peekSeq = 0;
      const sync = () => {
        const v = input.value.trim();
        const ok = isUrl(v) || (v.length > 2 && !/\s{2,}/.test(v));
        go.disabled = !ok;
        $e('.sdl-clear').hidden = !v;
        $e('.sdl-paste').hidden = !!v;
        pl.hidden = !LIST_LINK.test(v);
        $$('.sdl-kinds button', el).forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
        $$('.sdl-q-chips button', el).forEach((b) => b.classList.toggle('on', b.dataset.q === quality));
        $e('.sdl-quality').classList.toggle('show', kind === 'video');
        $('span', go).textContent = !v ? 'Download' : kind === 'song' ? (pl.hidden || !$('input', pl).checked ? 'Download song' : 'Download all as songs') : (pl.hidden || !$('input', pl).checked ? 'Download video' : 'Download all as videos');
        const pv = $e('.sdl-preview');
        if (!isUrl(v)) { pv.hidden = true; pv.innerHTML = ''; return; }
        const seq = ++peekSeq;
        const src = sourceOf(v);
        pv.hidden = false;
        pv.innerHTML = `<div class="sdl-pv-art skel"></div><div class="sdl-pv-t"><span class="sdl-src" style="--c:${src.color}">${esc(src.name)}</span><b class="skel-line"></b><small class="skel-line short"></small></div>`;
        peek(v).then((p) => {
          if (seq !== peekSeq) return;
          const square = /SoundCloud|Spotify|Bandcamp|YouTube Music/.test(p.source.name);
          pv.innerHTML = `<div class="sdl-pv-art ${square ? 'square' : ''}">${p.thumb ? `<img src="${esc(p.thumb)}" onerror="this.remove()" />` : icon(MUSIC_SITES.test(v) ? 'music' : 'video', 28)}</div>
            <div class="sdl-pv-t"><span class="sdl-src" style="--c:${p.source.color}">${esc(p.source.name)}${LIST_LINK.test(v) ? ' · Playlist' : ''}</span><b>${esc(p.title || 'Ready to download')}</b><small>${esc(p.author || v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</small></div>`;
        });
      };
      const setLink = (v) => {
        input.value = v || '';
        if (MUSIC_SITES.test(input.value)) kind = 'song';
        sync();
      };
      input.addEventListener('input', () => { if (MUSIC_SITES.test(input.value)) kind = 'song'; sync(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); start(); } });
      $e('.sdl-clear').onclick = () => { setLink(''); input.focus(); };
      $e('.sdl-paste').onclick = async () => {
        SpotUI.haptic('light');
        try {
          const t = (await navigator.clipboard.readText() || '').trim();
          if (!t) return UI.toast('Your clipboard is empty');
          const url = (t.match(/https?:\/\/\S+/) || [t])[0];
          setLink(url);
        } catch { input.focus(); UI.toast('Long-press the box and tap Paste'); }
      };
      $$('.sdl-kinds button', el).forEach((b) => b.onclick = () => { kind = b.dataset.k; SpotUI.haptic('select'); remember(); sync(); });
      $$('.sdl-q-chips button', el).forEach((b) => b.onclick = () => { quality = b.dataset.q; SpotUI.haptic('select'); remember(); sync(); });
      $('input', pl).onchange = (e) => { State.setSetting('dlPlaylist', e.target.checked); sync(); };
      $e('.sdl-search').onclick = () => SpotViews.focusSearch('');
      const remember = () => State.setSetting('dlFormat', kind === 'song' ? 'audio-mp3' : quality);

      async function start() {
        const v = input.value.trim();
        if (!v || go.disabled) return;
        go.disabled = true;
        go.classList.add('busy');
        $('span', go).textContent = /spotify/i.test(v) ? 'Reading Spotify…' : 'Starting…';
        try {
          const jobs = await native.dl.add({ url: v, format: kind === 'song' ? 'audio-mp3' : quality, dir: State.settings().downloadDir, playlist: !pl.hidden && $('input', pl).checked, addToLibrary: true });
          jobs.forEach((j) => DL.jobs.set(j.id, j));
          SpotUI.haptic('medium');
          setLink('');
          drawJobs();
          setTimeout(() => { const a = $e('.sdl-active'); if (a && !a.hidden) a.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
        } catch (e) {
          UI.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 5000);
        } finally {
          go.classList.remove('busy');
          sync();
        }
      }
      go.onclick = start;

      // ----- downloads in progress and failed -----
      const cards = new Map();
      function card(j) {
        let c = cards.get(j.id);
        const vid = kindOf(j.format) === 'video';
        if (!c) {
          c = html(`<div class="sdl-card" data-id="${esc(j.id)}">
            <div class="sdl-c-art ${vid ? 'wide' : ''}"><img alt="" /><span class="sdl-c-ic"></span></div>
            <div class="sdl-c-t"><b></b><small class="sdl-c-status"></small><div class="sdl-c-bar"><i></i></div></div>
            <div class="sdl-c-btns"></div>
          </div>`);
          cards.set(j.id, c);
        }
        const thumb = j.thumbnail || (j.meta && j.meta.cover) || (ytId(j.url) ? `https://i.ytimg.com/vi/${ytId(j.url)}/hqdefault.jpg` : '');
        const img = $('img', c);
        if (thumb && img.getAttribute('src') !== thumb) { img.src = thumb; img.onerror = () => { img.removeAttribute('src'); }; }
        $('.sdl-c-ic', c).innerHTML = thumb ? '' : icon(vid ? 'video' : 'music', 22);
        const peeked = peekCache.get(j.displayUrl || j.url);
        const raw = String(j.title || j.url);
        $('b', c).textContent = (raw === j.url || raw === j.displayUrl) && peeked && peeked.title ? peeked.title : raw.replace(/^Search: /, '');
        const failed = FAILED.includes(j.status);
        c.classList.toggle('failed', failed);
        c.classList.toggle('queued', j.status === 'queued');
        const st = $('.sdl-c-status', c);
        if (failed) st.textContent = j.status === 'cancelled' ? 'Cancelled' : (j.error || 'Download failed');
        else if (j.status === 'queued') st.textContent = 'Waiting to start…';
        else if (j.statusText) st.textContent = j.statusText;
        else st.textContent = [`${Math.round(j.progress || 0)}%`, j.speed, j.eta && j.eta !== 'Unknown' ? j.eta + ' left' : ''].filter(Boolean).join(' · ');
        $('.sdl-c-bar i', c).style.width = (failed ? 0 : Math.max(2, j.progress || 0)) + '%';
        $('.sdl-c-bar', c).classList.toggle('indeterminate', !failed && (j.status === 'queued' || (!j.progress && !!j.statusText)));
        const btns = $('.sdl-c-btns', c);
        const want = failed ? 'failed' : 'active';
        if (btns.dataset.mode !== want) {
          btns.dataset.mode = want;
          btns.innerHTML = failed
            ? `<button class="sdl-c-btn retry" aria-label="Retry">${icon('refresh', 20)}</button><button class="sdl-c-btn more" aria-label="More">${icon('dotsH', 20)}</button>`
            : `<button class="sdl-c-btn cancel" aria-label="Cancel">${icon('close', 18)}</button>`;
          const b = (q) => $(q, btns);
          if (b('.retry')) b('.retry').onclick = () => { SpotUI.haptic('medium'); native.dl.retry(j.id); };
          if (b('.cancel')) b('.cancel').onclick = () => { SpotUI.haptic('light'); native.dl.cancel(j.id); };
          if (b('.more')) b('.more').onclick = () => failSheet(DL.jobs.get(j.id) || j);
        }
        if (failed) c.onclick = (e) => { if (!e.target.closest('button')) failSheet(DL.jobs.get(j.id) || j); };
        return c;
      }
      function drawJobs() {
        const js = [...DL.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
        const act = js.filter((j) => ACTIVE.includes(j.status)), bad = js.filter((j) => j.status === 'error');
        const place = (sec, list) => {
          const box = $('.sdl-cards', sec);
          sec.hidden = !list.length;
          $('h2 em', sec).textContent = list.length > 1 ? list.length : '';
          const keep = new Set(list.map((j) => j.id));
          [...box.children].forEach((n) => { if (!keep.has(n.dataset.id)) n.remove(); });
          list.forEach((j, i) => { const c = card(j); if (box.children[i] !== c) box.insertBefore(c, box.children[i] || null); });
        };
        place($e('.sdl-active'), act);
        place($e('.sdl-failed'), bad);
        $e('.sdl-retry-all').hidden = bad.length < 2;
      }
      $e('.sdl-retry-all').onclick = () => { SpotUI.haptic('medium'); [...DL.jobs.values()].filter((j) => j.status === 'error').forEach((j) => native.dl.retry(j.id)); };
      const offJob = native.dl.onJob((j) => {
        DL.jobs.set(j.id, j);
        if (!el.isConnected) return;
        if (j.status === 'done') { const c = cards.get(j.id); if (c) { c.classList.add('done'); setTimeout(drawJobs, 450); } else drawJobs(); }
        else drawJobs();
      });
      const offRemoved = native.dl.onRemoved((id) => { DL.jobs.delete(id); if (el.isConnected) drawJobs(); });

      // ----- recently downloaded -----
      const rst = { kind: 'all', limit: 25 };
      function drawRecent() {
        const host = $e('.sdl-recent');
        const all = State.allTracks().filter((t) => t.source !== 'local').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        host.innerHTML = '';
        if (!all.length) {
          host.appendChild(html(`<div class="sdl-empty">${icon('downloadCircle', 44)}<b>Nothing downloaded yet</b><span>Songs and videos you download show up here, ready to play offline.</span></div>`));
          return;
        }
        const list = all.filter((t) => rst.kind === 'all' || (rst.kind === 'video' ? t.kind === 'video' : t.kind !== 'video'));
        const nS = all.filter((t) => t.kind !== 'video').length, nV = all.length - nS;
        const head = html(`<div class="sdl-r-head">
          <div><h2>Recently downloaded</h2><span>${nS} song${nS === 1 ? '' : 's'} · ${nV} video${nV === 1 ? '' : 's'}</span></div>
          <button class="sp-bigplay sdl-r-play" aria-label="Play">${icon('play', 24)}</button>
        </div>`);
        const chips = html(`<div class="sdl-r-chips"><button class="sp-chip" data-k="all">All</button><button class="sp-chip" data-k="song">Songs</button><button class="sp-chip" data-k="video">Videos</button></div>`);
        $$('button', chips).forEach((b) => { b.classList.toggle('on', b.dataset.k === rst.kind); b.onclick = () => { SpotUI.haptic('select'); rst.kind = b.dataset.k; rst.limit = 25; drawRecent(); }; });
        const ids = list.map((t) => t.id);
        $('.sdl-r-play', head).onclick = () => { if (ids.length) Player.playContext({ key: 'downloads', name: 'Recently downloaded' }, ids, 0); };
        host.append(head, chips);
        const dayOf = (ts) => {
          const d = new Date(ts || 0);
          if (d.toDateString() === new Date().toDateString()) return 'Today';
          if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
          if (Date.now() - d < 7 * 864e5) return d.toLocaleDateString(undefined, { weekday: 'long' });
          return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
        };
        let day = '';
        list.slice(0, rst.limit).forEach((t, i) => {
          const d = dayOf(t.addedAt);
          if (d !== day) { day = d; host.appendChild(html(`<div class="sdl-day">${esc(d)}</div>`)); }
          host.appendChild(SpotViews.row(t, { type: t.kind === 'video' ? 'Video' : 'Song', play: () => Player.playContext({ key: 'downloads', name: 'Recently downloaded' }, ids, i) }));
        });
        if (list.length > rst.limit) {
          const more = html(`<button class="sdl-more">Show more</button>`);
          more.onclick = () => { rst.limit += 25; drawRecent(); };
          host.appendChild(more);
        }
      }
      const offLib = State.on('library', debounce(() => { if (el.isConnected) drawRecent(); }, 500));

      // ----- engine -----
      function drawEngine(t) {
        const host = $e('.sdl-engine');
        host.innerHTML = `<div class="sdl-eng-row"><span class="sdl-eng-dot ${t && t.ytdlp ? 'ok' : ''}"></span>
          <div><b>Download engine</b><small>${t && t.ytdlp ? `yt-dlp ${esc(t.ytdlp)}${t.updated ? ' · updated in the app' : ''} · keeps itself up to date` : esc((t && t.error) || 'Starting…')}</small></div>
          <button class="sdl-text-btn sdl-upd">Update</button></div>
          <p>If YouTube blocks one way of downloading, Aurora automatically tries five others and updates itself. Only download what you have the right to save.</p>`;
        const u = $('.sdl-upd', host);
        u.onclick = async () => {
          u.disabled = true; u.textContent = 'Checking…';
          try { await native.dl.updateYtdlp(); const x = await native.dl.tools(); drawEngine(x); } catch (e) { UI.toast('Update failed: ' + e.message); u.disabled = false; u.textContent = 'Update'; }
        };
      }
      native.dl.tools().then(drawEngine).catch(() => drawEngine(null));

      setLink(prefill || '');
      drawJobs();
      drawRecent();
      return () => { offJob && offJob(); offRemoved && offRemoved(); offLib && offLib(); };
    },
  };

  // why a download failed, in plain words, plus the technical details for reporting it
  function failSheet(j) {
    const detail = j.errorDetail || j.error || '';
    SpotUI.sheet([
      { icon: 'refresh', round: true, label: 'Try again', sub: 'Aurora tries every download method again', action: () => native.dl.retry(j.id) },
      kindOf(j.format) === 'video'
        ? { icon: 'music', round: true, label: 'Try as a song instead', sub: 'Audio only is often easier to get', action: () => native.dl.add({ url: j.displayUrl || j.url, format: 'audio-mp3', addToLibrary: true, meta: j.meta || null }).then(() => native.dl.remove(j.id)) }
        : null,
      { icon: 'search', round: true, label: 'Search for another upload', action: () => SpotViews.focusSearch(String(j.title || '').replace(/^Search: /, '')) },
      detail ? { icon: 'copy', round: true, label: 'Copy error details', sub: 'Useful when reporting a problem', action: () => { try { navigator.clipboard.writeText(`${j.title || ''}\n${j.displayUrl || j.url}\n\n${detail}`); UI.toast('Copied'); } catch { UI.toast('Couldn\'t copy'); } } } : null,
      { icon: 'trash', round: true, label: 'Remove from list', danger: true, action: () => native.dl.remove(j.id) },
    ], { head: `<div class="sdl-fs-head"><div class="sdl-fs-ic">${icon('warning', 26)}</div><div><b>${esc(String(j.title || j.url).replace(/^Search: /, ''))}</b><span>${esc(j.error || 'Download failed')}</span></div></div>` });
  }

  function install() {
    if ((State.settings().iosLayout || 'standard') === 'classic') return;
    Views.downloader = view;
  }
  return { install, view, sourceOf };
})();
