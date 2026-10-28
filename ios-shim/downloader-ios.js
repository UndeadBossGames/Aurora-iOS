// Aurora for iPhone: the Video Downloader engine for the web UI.
// Gives `native.dl` the same API as the PC version; the work happens in the native AuroraDL
// plugin (yt-dlp in embedded Python + AVFoundation merging). Several downloads run at once,
// with no speed limit, so playlists finish as fast as the connection allows.
(function () {
  const Cap = window.Capacitor || {};
  const plugin = Cap.registerPlugin ? Cap.registerPlugin('AuroraDL') : (Cap.Plugins || {}).AuroraDL;
  const Http = (Cap.Plugins || {}).CapacitorHttp;
  const MAX_PARALLEL = 5;
  const FORMATS = {
    'video-best': { label: 'Video · Best quality (MP4)', kind: 'video' },
    'video-1080': { label: 'Video · 1080p (MP4)', kind: 'video' },
    'video-720': { label: 'Video · 720p (MP4)', kind: 'video' },
    'audio-mp3': { label: 'Audio · Best (M4A/MP3)', kind: 'audio' },
    'audio-m4a': { label: 'Audio · M4A', kind: 'audio' },
  };
  const jobs = new Map();
  const queue = [];
  let running = 0;
  const L = { job: [], file: [], removed: [], cleared: [], tools: [] };
  const on = (k) => (fn) => { L[k].push(fn); return () => { L[k] = L[k].filter((f) => f !== fn); }; };
  const fire = (k, v) => L[k].forEach((f) => { try { f(v); } catch (e) { console.warn(e); } });
  const pub = (j) => { const { _resolveRun, ...rest } = j; return JSON.parse(JSON.stringify(rest)); };
  const emitJob = (j) => fire('job', pub(j));
  const rid = () => Math.random().toString(36).slice(2, 14);
  const parse = (r) => { try { return JSON.parse(r && r.json); } catch { return null; } };

  function sourceName(url) {
    const map = [[/music\.youtube/i, 'YouTube Music'], [/youtube\.com|youtu\.be|^ytsearch/i, 'YouTube'], [/soundcloud/i, 'SoundCloud'], [/vimeo/i, 'Vimeo'], [/tiktok/i, 'TikTok'],
      [/twitter\.com|x\.com/i, 'X'], [/instagram/i, 'Instagram'], [/twitch/i, 'Twitch'], [/bandcamp/i, 'Bandcamp'], [/facebook|fb\.watch/i, 'Facebook'], [/reddit/i, 'Reddit'],
      [/dailymotion/i, 'Dailymotion'], [/mixcloud/i, 'Mixcloud'], [/spotify/i, 'Spotify']];
    for (const [re, n] of map) if (re.test(url)) return n;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Web'; }
  }

  // ---- Spotify: read the track names, then download matching public uploads ----
  function findKey(obj, key, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    if (obj[key] && typeof obj[key] === 'object') return obj[key];
    for (const v of Object.values(obj)) { const r = findKey(v, key, depth + 1); if (r) return r; }
    return null;
  }
  async function resolveSpotify(url) {
    const m = url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|artist)\/([A-Za-z0-9]+)/i);
    if (!m) throw new Error('Unrecognised Spotify link');
    const r = Http ? await Http.get({ url: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, headers: { 'Accept-Language': 'en' }, responseType: 'text' }) : { data: await (await fetch(`https://open.spotify.com/embed/${m[1]}/${m[2]}`)).text() };
    const html = typeof r.data === 'string' ? r.data : '';
    const nd = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!nd) throw new Error('Could not read the Spotify page');
    const entity = findKey(JSON.parse(nd[1]), 'entity') || {};
    const srcs = (entity.coverArt && entity.coverArt.sources) || (entity.visualIdentity && entity.visualIdentity.image) || [];
    const cover = srcs.length ? [...srcs].sort((a, b) => (b.maxWidth || b.width || 0) - (a.maxWidth || a.width || 0))[0].url : null;
    const tracks = [];
    if (Array.isArray(entity.trackList) && entity.trackList.length) for (const t of entity.trackList) tracks.push({ title: t.title, artist: t.subtitle || '', cover });
    else if (entity.title || entity.name) tracks.push({ title: entity.title || entity.name, artist: (entity.artists || []).map((a) => a.name).join(', ') || entity.subtitle || '', cover });
    if (!tracks.length) throw new Error('No tracks found on that Spotify page');
    return { type: m[1], tracks };
  }

  function createJob(o) {
    const j = { id: rid(), status: 'queued', progress: 0, speed: '', eta: '', createdAt: Date.now(), files: [], error: null, statusText: '', ...o };
    jobs.set(j.id, j);
    queue.push(j.id);
    emitJob(j);
    return j;
  }

  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      const j = jobs.get(queue.shift());
      if (!j || j.status !== 'queued') continue;
      running++;
      run(j).finally(() => { running--; pump(); });
    }
  }

  function run(j) {
    return new Promise((resolve) => {
      j._resolveRun = resolve;
      j.status = 'downloading';
      j.statusText = 'Starting…';
      emitJob(j);
      if (!plugin) return fail(j, 'The download engine is missing from this build.');
      plugin.start({ job: { id: j.id, url: j.url, format: j.format, playlist: j.playlist, dir: 'Music/Downloads', meta: j.meta || null, source: j.source } })
        .then((r) => { const res = parse(r); if (res && res.ok === false) fail(j, res.error || 'Could not start'); })
        .catch((e) => fail(j, e.message || String(e)));
    });
  }
  function settle(j) { const r = j._resolveRun; delete j._resolveRun; if (r) r(); }
  function fail(j, msg) { j.status = 'error'; j.error = String(msg || 'Download failed').split('\n').filter(Boolean).pop(); emitJob(j); settle(j); }

  // events from the native engine
  if (plugin && plugin.addListener) {
    plugin.addListener('dl', (ev) => {
      const j = jobs.get(ev.jobId);
      if (!j) return;
      switch (ev.type) {
        case 'status': j.status = ev.status || j.status; j.statusText = ev.statusText || ''; if (ev.progress != null) j.progress = ev.progress; break;
        case 'start': j.title = ev.title || j.title; j.thumbnail = ev.thumbnail || j.thumbnail; j.statusText = ''; break;
        case 'progress': j.progress = ev.progress || 0; j.speed = ev.speed || ''; j.eta = ev.eta || ''; j.statusText = ''; break;
        case 'file': {
          const t = { ...ev.track, id: native._trackId(ev.track.path), addedAt: Date.now() };
          j.files.push(t);
          fire('file', { jobId: j.id, track: t, addToLibrary: j.addToLibrary });
          break;
        }
        case 'done': j.status = 'done'; j.progress = 100; j.statusText = j.files.length > 1 ? `${j.files.length} files` : ''; emitJob(j); settle(j); return;
        case 'cancelled': j.status = 'cancelled'; emitJob(j); settle(j); return;
        case 'error': fail(j, ev.error); return;
        case 'expand': {
          // a playlist/album: queue every entry as its own download so they run in parallel
          const entries = ev.entries || [];
          j.status = 'done'; j.progress = 100; j.title = ev.title || j.title;
          j.statusText = `${entries.length} item${entries.length === 1 ? '' : 's'} queued`;
          emitJob(j); settle(j);
          for (const e of entries) createJob({ url: e.url, displayUrl: e.url, title: e.title, thumbnail: e.thumbnail, source: j.source, format: j.format, playlist: false, addToLibrary: j.addToLibrary });
          pump();
          return;
        }
        default: return;
      }
      emitJob(j);
    });
  }

  let toolsCache = null;
  const dl = {
    async add({ url, format = 'video-best', playlist = false, addToLibrary = true }) {
      url = String(url || '').trim();
      if (!url) throw new Error('Paste a link first');
      if (!/^https?:\/\//i.test(url) && !/^(yt|sc)search\d*:/i.test(url)) url = 'ytsearch1:' + url;
      const created = [];
      if (/open\.spotify\.com/i.test(url)) {
        const sp = await resolveSpotify(url);
        const fmt = format.startsWith('video') ? 'audio-m4a' : format;
        for (const t of sp.tracks.slice(0, sp.type === 'track' ? 1 : 500)) {
          created.push(createJob({ url: `ytsearch1:${t.artist ? t.artist + ' - ' : ''}${t.title} audio`, displayUrl: url, title: `${t.artist ? t.artist + ' - ' : ''}${t.title}`, source: 'Spotify', format: fmt, playlist: false, addToLibrary, meta: t }));
        }
      } else {
        created.push(createJob({ url, displayUrl: url, title: url.replace(/^ytsearch1:/, 'Search: '), source: sourceName(url), format, playlist, addToLibrary }));
      }
      pump();
      return created.map(pub);
    },
    async search(q, source = 'youtube', limit = 18) {
      if (!plugin) throw new Error('The download engine is missing from this build.');
      const res = parse(await plugin.search({ q, source, limit }));
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Search failed');
      return res.results || [];
    },
    async list() { return [...jobs.values()].map(pub); },
    async cancel(id) {
      const j = jobs.get(id);
      if (!j) return;
      if (j.status === 'queued') { j.status = 'cancelled'; emitJob(j); return; }
      if (plugin) await plugin.cancel({ id });
    },
    async retry(id) {
      const j = jobs.get(id);
      if (!j || j.status === 'downloading') return;
      Object.assign(j, { status: 'queued', progress: 0, error: null, statusText: '', files: [] });
      queue.push(j.id); emitJob(j); pump();
    },
    async remove(id) { await dl.cancel(id); jobs.delete(id); fire('removed', id); },
    async clear() { for (const [id, j] of jobs) if (['done', 'error', 'cancelled'].includes(j.status)) jobs.delete(id); fire('cleared'); },
    async tools() {
      if (!toolsCache && plugin) {
        try { const r = await plugin.info(); toolsCache = r && r.json ? JSON.parse(r.json) : { ok: false, error: r && r.error }; } catch (e) { toolsCache = { ok: false, error: e.message }; }
      }
      const t = toolsCache || {};
      return { ytdlp: t.ytdlp || null, ffmpeg: true, ios: true, python: t.python, error: t.ok === false ? t.error : null, updated: !!t.updated, formats: FORMATS };
    },
    async updateYtdlp() {
      if (!plugin) throw new Error('The download engine is missing from this build.');
      fire('tools', { status: 'Checking for a newer yt-dlp…' });
      const res = parse(await plugin.update());
      if (!res || res.ok === false) { fire('tools', { status: 'Update failed' }); throw new Error((res && res.error) || 'Update failed'); }
      fire('tools', { status: res.changed ? `yt-dlp ${res.version} downloaded. Close and reopen Aurora to use it.` : `yt-dlp is up to date (${res.version})` });
      return res;
    },
    async installFfmpeg() { return true; },
    onJob: on('job'), onFile: on('file'), onRemoved: on('removed'), onCleared: on('cleared'), onTools: on('tools'),
    FORMATS,
  };

  window.native.dl = dl;
  // light haptics for taps (no-op where the native side isn't available)
  window.native.haptic = (style = 'light') => { try { plugin && plugin.haptic({ style }); } catch {} };
})();
