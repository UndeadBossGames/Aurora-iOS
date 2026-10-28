// Aurora for iPhone: the `window.native` bridge.
// On Windows, Electron's main process provides `window.native`. On iPhone the same UI runs inside
// Capacitor, and this file provides the same API on top of Capacitor's Filesystem, FilePicker and
// HTTP plugins. Paths are stored *relative* ("docs/Music/x.mp3", "lib/covers/y.jpg") because iOS
// moves the app's container every time the app is reinstalled or updated.
(function () {
  const Cap = window.Capacitor || {};
  const P = Cap.Plugins || {};
  const FS = P.Filesystem, Picker = P.FilePicker, Http = P.CapacitorHttp;
  const DOCS = 'DOCUMENTS', LIB = 'LIBRARY';
  const DATA_DIR = 'aurora-data', COVER_DIR = 'aurora-covers', MUSIC_DIR = 'Music';
  const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.alac', '.aiff', '.caf'];
  const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm'];
  const MEDIA_EXT = [...AUDIO_EXT, ...VIDEO_EXT];
  const roots = { docs: '', lib: '' };
  const ext = (p) => { const m = String(p).toLowerCase().match(/\.[a-z0-9]+$/); return m ? m[0] : ''; };
  const base = (p) => String(p).split('/').pop();
  const noop = () => () => {};
  const err = (m) => Promise.reject(new Error(m));
  const split = (rel) => { const m = String(rel).match(/^(docs|lib)\/(.*)$/); return m ? { directory: m[1] === 'docs' ? DOCS : LIB, path: m[2] } : null; };

  async function ensureDir(path, directory) { try { await FS.mkdir({ path, directory, recursive: true }); } catch {} }

  // ---------- small JSON store ----------
  const store = {
    async read(name, fallback) {
      try { const r = await FS.readFile({ path: `${DATA_DIR}/${name}.json`, directory: LIB, encoding: 'utf8' }); return JSON.parse(r.data); } catch { return fallback; }
    },
    async write(name, data) {
      await FS.writeFile({ path: `${DATA_DIR}/${name}.json`, directory: LIB, encoding: 'utf8', data: JSON.stringify(data), recursive: true });
      return true;
    },
    async remove(name) { try { await FS.deleteFile({ path: `${DATA_DIR}/${name}.json`, directory: LIB }); } catch {} return true; },
  };

  // ---------- tags: title / artist / album / cover from ID3v2 ----------
  const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
  const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  function decodeText(b) {
    if (!b.length) return '';
    const enc = b[0]; let d = b.subarray(1), s;
    if (enc === 1 || enc === 2) {
      let le = enc === 1;
      if (d[0] === 0xff && d[1] === 0xfe) { d = d.subarray(2); le = true; } else if (d[0] === 0xfe && d[1] === 0xff) { d = d.subarray(2); le = false; }
      s = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(d.subarray(0, d.length - (d.length % 2)));
    } else s = new TextDecoder(enc === 3 ? 'utf-8' : 'latin1').decode(d);
    return s.replace(/\u0000+$/g, '').split('\u0000')[0].trim();
  }
  function readId3(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 10 || String.fromCharCode(b[0], b[1], b[2]) !== 'ID3') return null;
    const ver = b[3], size = syncsafe(b, 6), tags = {};
    const body = b.subarray(10, 10 + size);
    let o = 0;
    if (b[5] & 0x40) o += ver === 4 ? syncsafe(body, 0) : u32(body, 0) + 4;
    while (o + 10 < body.length) {
      const id = String.fromCharCode(body[o], body[o + 1], body[o + 2], body[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fsize = ver === 4 ? syncsafe(body, o + 4) : u32(body, o + 4);
      if (fsize <= 0 || o + 10 + fsize > body.length) break;
      const f = body.subarray(o + 10, o + 10 + fsize);
      if (id === 'TIT2') tags.title = decodeText(f);
      else if (id === 'TPE1') tags.artist = decodeText(f);
      else if (id === 'TALB') tags.album = decodeText(f);
      else if (id === 'APIC' && !tags.picture) {
        const enc = f[0]; let p = 1;
        const me = f.indexOf(0, p);
        const mime = new TextDecoder('latin1').decode(f.subarray(p, me)) || 'image/jpeg';
        p = me + 2;
        if (enc === 1 || enc === 2) { while (p + 1 < f.length && !(f[p] === 0 && f[p + 1] === 0)) p += 2; p += 2; } else { while (p < f.length && f[p] !== 0) p++; p += 1; }
        tags.picture = { mime: mime.includes('/') ? mime : 'image/' + mime.toLowerCase(), data: f.subarray(p) };
      }
      o += 10 + fsize;
    }
    return tags;
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function hashId(s) { // 16 hex chars, stable per relative path
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (const c of String(s).toLowerCase()) { const k = c.codePointAt(0); h1 = Math.imul(h1 ^ k, 16777619); h2 = Math.imul(h2 ^ k, 2246822519); }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }
  function guess(name) {
    const b = name.replace(/\.[^.]+$/, '').replace(/\s*\[[A-Za-z0-9_-]{6,}\]$/, '').replace(/_/g, ' ');
    const m = b.match(/^(.+?)\s+-\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: b.trim(), artist: '' };
  }
  async function readTrack(rel) {
    const id = hashId(rel), e = ext(rel), g = guess(base(rel));
    const parts = rel.split('/');
    const t = { id, path: rel, title: g.title, artist: g.artist || 'Unknown artist', album: parts.length > 2 ? parts[parts.length - 2] : 'iPhone', kind: VIDEO_EXT.includes(e) ? 'video' : 'audio', source: 'local', duration: 0, cover: null, addedAt: Date.now() };
    if (e === '.mp3') {
      try {
        const buf = await (await fetch(native.fileUrl(rel))).arrayBuffer();
        const tags = readId3(buf);
        if (tags) {
          if (tags.title) t.title = tags.title;
          if (tags.artist) t.artist = tags.artist;
          if (tags.album) t.album = tags.album;
          if (tags.picture && tags.picture.data.length > 100) {
            const path = `${COVER_DIR}/${id}${tags.picture.mime.includes('png') ? '.png' : '.jpg'}`;
            await FS.writeFile({ path, directory: LIB, data: b64(tags.picture.data), recursive: true });
            t.cover = 'lib/' + path;
          }
        }
      } catch (e2) { console.warn('tags', rel, e2); }
    }
    return t;
  }
  async function walk(directory, path, out, depth = 0) {
    if (depth > 6) return out;
    let r; try { r = await FS.readdir({ path, directory }); } catch { return out; }
    for (const f of r.files || []) {
      const name = typeof f === 'string' ? f : f.name;
      if (!name || name.startsWith('.') || name === DATA_DIR || name === COVER_DIR) continue;
      if (/\.(video|audio)\.[a-z0-9]+$|\.part$|\.ytdl$|\.f\d+\.[a-z0-9]+$|\.temp\.[a-z0-9]+$/i.test(name)) continue;
      const p = path ? `${path}/${name}` : name;
      if (f.type === 'directory') await walk(directory, p, out, depth + 1);
      else if (MEDIA_EXT.includes(ext(name))) out.push(p);
    }
    return out;
  }
  async function scanDocs() {
    const files = await walk(DOCS, '', []);
    const out = [];
    for (const f of files) out.push(await readTrack('docs/' + f));
    return out;
  }
  async function uniqueName(dir, name) {
    const m = name.match(/^(.*?)(\.[^.]*)?$/); let n = 0, cand = name;
    for (;;) {
      try { await FS.stat({ path: `${dir}/${cand}`, directory: DOCS }); n++; cand = `${m[1]} (${n})${m[2] || ''}`; } catch { return cand; }
    }
  }

  // read any picked file (or blob) as a data URL
  const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  function pickWithInput(accept, multiple) {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = accept; i.multiple = !!multiple; i.style.display = 'none';
      i.onchange = () => { resolve([...i.files]); i.remove(); };
      document.body.appendChild(i); i.click();
    });
  }

  async function http(url) {
    if (Http) { const r = await Http.get({ url, headers: { Accept: 'application/json' } }); if (r.status >= 400) throw new Error('HTTP ' + r.status); return typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
    const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
  }

  const IOS_REPO = 'UndeadBossGames/Aurora-iOS';
  const version = window.AURORA_IOS_VERSION || '1.0.0';
  const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
  const artCache = {};

  const native = {
    platform: 'ios',
    ready: null,
    fileUrl(p) {
      if (!p) return '';
      if (/^(data:|https?:|blob:|capacitor:)/.test(p)) return p;
      const m = String(p).match(/^(docs|lib)\/(.*)$/);
      if (!m) return p;
      const root = roots[m[1]];
      const url = root + '/' + m[2].split('/').map(encodeURIComponent).join('/');
      return Cap.convertFileSrc ? Cap.convertFileSrc(url) : url;
    },
    pathForFile: () => '',
    store,
    app: {
      info: async () => ({ version, platform: 'ios', electron: null, userData: '', customDir: '', coversDir: 'lib/' + COVER_DIR, music: '', videos: '', downloads: '', ios: true }),
      customFiles: async () => ({ css: (await store.read('custom-css', '')) || '', js: '' }),
      saveCustomCss: async (css) => store.write('custom-css', css),
      devtools: async () => {}, reload: async () => location.reload(), relaunch: async () => location.reload(), quit: async () => {},
      fullscreen: async () => {}, overlay: async () => {}, onFullscreen: noop,
    },
    dialog: {
      folder: async () => 'docs/',
      // Pick songs/videos from the Files app; they're copied into Aurora's own folder.
      async files() {
        let picked = [];
        if (Picker) {
          // no `types` filter: iOS greys out some music files when filtering by type, so we accept anything and keep media files below
          try { picked = (await Picker.pickFiles({ limit: 0 })).files || []; }
          catch (e) { if (/cancel/i.test(e.message || '')) return []; throw e; }
          await ensureDir(MUSIC_DIR, DOCS);
          const out = [];
          for (const f of picked) {
            if (!MEDIA_EXT.includes(ext(f.name))) continue;
            const name = await uniqueName(MUSIC_DIR, f.name);
            await FS.copy({ from: f.path, to: `${MUSIC_DIR}/${name}`, toDirectory: DOCS });
            out.push(`docs/${MUSIC_DIR}/${name}`);
          }
          return out;
        }
        // browser fallback (used by the test harness)
        const files = await pickWithInput('audio/*,video/*', true);
        const out = [];
        for (const f of files) {
          const name = await uniqueName(MUSIC_DIR, f.name);
          await FS.writeFile({ path: `${MUSIC_DIR}/${name}`, directory: DOCS, data: (await toDataUrl(f)).split(',')[1], recursive: true });
          out.push(`docs/${MUSIC_DIR}/${name}`);
        }
        return out;
      },
      async image() {
        const [f] = await pickWithInput('image/*', false);
        if (!f) return null;
        if (f.size > 25 * 1024 * 1024) throw new Error('That image is too large (max 25 MB).');
        return toDataUrl(f);
      },
      confirm: async ({ message, detail }) => window.confirm(detail ? `${message}\n\n${detail}` : message),
    },
    library: {
      scan: async () => scanDocs(),
      readFiles: async (files) => { const out = []; for (const f of files) if (MEDIA_EXT.includes(ext(f))) out.push(await readTrack(f)); return out; },
      exists: async (files) => Promise.all(files.map(async (f) => { const s = split(f); if (!s) return false; try { await FS.stat(s); return true; } catch { return false; } })),
      async saveCover(id, dataUrl) {
        const m = String(dataUrl).match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
        if (!m) return null;
        const path = `${COVER_DIR}/${id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
        await FS.writeFile({ path, directory: LIB, data: m[2], recursive: true });
        return 'lib/' + path;
      },
      // friend sharing: the bytes of a song to send, and saving one a friend sent
      async readBytes(p) {
        const buf = await (await fetch(native.fileUrl(p))).arrayBuffer();
        if (buf.byteLength > 80 * 1024 * 1024) throw new Error('This file is too large to send (max 80 MB).');
        return new Uint8Array(buf);
      },
      async saveIncoming({ name, bytes }) {
        const dir = `${MUSIC_DIR}/From friends`;
        const safe = String(name || 'song').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'song';
        if (!MEDIA_EXT.includes(ext(safe))) throw new Error('Not a music or video file.');
        await ensureDir(dir, DOCS);
        const file = await uniqueName(dir, safe);
        await FS.writeFile({ path: `${dir}/${file}`, directory: DOCS, data: b64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) });
        return readTrack(`docs/${dir}/${file}`);
      },
      // Same Wi-Fi as the sending PC: download straight from it (full speed, no size limit).
      // Tries each of the PC's addresses; gives up on one if nothing arrives within a few seconds.
      async downloadUrl({ urls, name, size, onProgress }) {
        if (!FS || !FS.downloadFile) throw new Error('no downloadFile');
        const dir = `${MUSIC_DIR}/From friends`;
        const safe = String(name || 'song').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'song';
        if (!MEDIA_EXT.includes(ext(safe))) throw new Error('Not a music or video file.');
        await ensureDir(dir, DOCS);
        for (const url of urls || []) {
          const file = await uniqueName(dir, safe);
          const path = `${dir}/${file}`;
          let last = Date.now(), handle = null;
          try {
            handle = await FS.addListener('progress', (e) => { if (e.url !== url) return; last = Date.now(); if (onProgress && e.contentLength) onProgress(Math.min(1, e.bytes / e.contentLength)); });
          } catch {}
          try {
            await new Promise((resolve, reject) => {
              const timer = setInterval(() => { if (Date.now() - last > 6000) { clearInterval(timer); reject(new Error('timeout')); } }, 1000);
              FS.downloadFile({ url, path, directory: DOCS, recursive: true, progress: true }).then((r) => { clearInterval(timer); resolve(r); }, (e) => { clearInterval(timer); reject(e); });
            });
            const st = await FS.stat({ path, directory: DOCS });
            if (size && st.size && st.size !== size) throw new Error('incomplete');
            if (handle && handle.remove) handle.remove();
            return readTrack(`docs/${path}`);
          } catch (e) {
            if (handle && handle.remove) handle.remove();
            try { await FS.deleteFile({ path, directory: DOCS }); } catch {}
          }
        }
        throw new Error('The PC isn\'t reachable on this Wi-Fi');
      },
      async deleteFile(p) { const s = split(p); if (!s) return false; try { await FS.deleteFile(s); return true; } catch { return false; } },
    },
    shell: {
      showItem: async () => window.UI && UI.toast('Open the Files app → On My iPhone → Aurora to see your files.', 5000),
      openPath: async () => window.UI && UI.toast('Open the Files app → On My iPhone → Aurora to see your files.', 5000),
      openExternal: async (url) => { if (/^https?:/i.test(url)) window.open(url, '_blank'); },
    },
    art: {
      async lookup(title, artist) {
        const q = [artist, title].filter((x) => x && !/^unknown artist$/i.test(x)).join(' ').trim();
        if (!q) return { album: null, artist: null };
        if (artCache[q]) return artCache[q];
        try {
          const r = await http(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`);
          const x = (r && r.data && r.data[0]) || null;
          return (artCache[q] = { album: x && x.album ? x.album.cover_xl || x.album.cover_big : null, artist: x && x.artist ? x.artist.picture_xl || x.artist.picture_big : null });
        } catch { return { album: null, artist: null }; }
      },
    },
    discord: {
      configure: async () => ({ state: 'unsupported' }),
      status: async () => ({ state: 'unsupported', defaultClientId: '' }),
      nowPlaying: async () => {},
      onStatus: noop,
    },
    update: {
      async check() {
        let r;
        try { r = await http(`https://api.github.com/repos/${IOS_REPO}/releases/latest`); } catch (e) { throw new Error("Couldn't reach GitHub"); }
        const latest = String(r.tag_name || version).replace(/^v/i, '');
        const ipa = (r.assets || []).find((a) => /\.ipa$/i.test(a.name));
        return { latest, current: version, newer: newer(latest, version), name: r.name, notes: r.body || '', url: r.html_url, asset: ipa ? { name: ipa.name, size: ipa.size, url: ipa.browser_download_url } : null, ios: true, checkedAt: Date.now() };
      },
      download: async () => err('On iPhone, install updates with Sideloadly on your PC. See the release page for the new Aurora.ipa.'),
      install: async () => err('On iPhone, install updates with Sideloadly on your PC.'),
      state: async () => ({ ready: null, info: null, downloading: false }),
      onProgress: noop,
    },
    // dl: the real downloader is added by ios/downloader-ios.js
    dl: null,
    _trackId: (p) => hashId(p),
  };

  native.ready = (async () => {
    if (!FS) throw new Error('Capacitor Filesystem is missing');
    const d = await FS.getUri({ path: '', directory: DOCS });
    const l = await FS.getUri({ path: '', directory: LIB });
    roots.docs = String(d.uri).replace(/\/$/, '');
    roots.lib = String(l.uri).replace(/\/$/, '');
    await ensureDir(MUSIC_DIR, DOCS);
    // leave a note in the Files app so people know where to put music
    try { await FS.stat({ path: 'Put your music here.txt', directory: DOCS }); } catch {
      try { await FS.writeFile({ path: 'Put your music here.txt', directory: DOCS, encoding: 'utf8', data: 'Copy songs and videos into this folder (or the Music folder) with iTunes File Sharing on your PC or the Files app.\nAurora adds them to your library automatically the next time it opens.\n' }); } catch {}
    }
    // The UI treats "music folders" as places to rescan on start-up: on iPhone that's Aurora's Documents folder.
    try {
      const s = (await store.read('settings', null)) || {};
      if (!Array.isArray(s.musicFolders) || !s.musicFolders.includes('docs/')) { s.musicFolders = ['docs/']; s.downloadDir = 'docs/'; await store.write('settings', s); }
    } catch {}
  })();

  window.native = native;
})();
