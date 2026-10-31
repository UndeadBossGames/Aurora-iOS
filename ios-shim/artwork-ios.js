// Aurora for iPhone: proper cover art.
// YouTube downloads come with a 16:9 video thumbnail (often the album cover with black bars and a
// channel logo), which looks wrong on the lock screen, in Control Center and in square tiles.
// For every download (and once for songs already in the library) this:
//   1) looks up the official album cover (Apple's iTunes Search, then Deezer) and uses it when the
//      song clearly matches; it also fills in the real song title, artist and album then;
//   2) otherwise fixes the thumbnail: cuts off black bars, and if the picture still isn't square,
//      puts it on a blurred, colour-matched square background with soft rounded corners.
const Artwork = (() => {
  const VERSION = 2;          // bump to re-check every song
  const SIZE = 600;
  const Http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;

  // ---------- making sense of YouTube titles ----------
  const JUNK = /\s*[([【](?:official|offical|lyric|lyrics|music|audio|video|visuali[sz]er|hd|hq|4k|explicit|clean|remaster(?:ed)?|color coded|letra|mv|m\/v|full album)[^)\]】]*[)\]】]/gi;
  const clean = (s) => String(s || '').replace(JUNK, '').replace(/\s*\|\s*.*$/, '').replace(/\s+/g, ' ').trim();
  const channelish = (a) => /vevo$|\s-\stopic$|^topic$|official|records|music$|tv$|channel/i.test(String(a || '').trim());
  const tokens = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['the', 'a', 'feat', 'ft', 'and', 'x', 'with'].includes(w));
  function guess(t) {
    let title = clean(t.title), artist = String(t.artist || '').replace(/vevo$/i, '').replace(/\s*-\s*topic$/i, '').trim();
    const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/); // "Artist - Title"
    if (m) { artist = m[1].trim(); title = m[2].trim(); }
    title = title.replace(/\s+(?:ft\.?|feat\.?|featuring)\s.*$/i, '').replace(/^["'“]|["'”]$/g, '').trim();
    return { title, artist };
  }
  function overlap(a, b) {
    const A = tokens(a), B = new Set(tokens(b));
    if (!A.length) return 0;
    return A.filter((w) => B.has(w)).length / A.length;
  }

  // ---------- network ----------
  async function getJson(url) {
    if (Http) { const r = await Http.get({ url, headers: { Accept: 'application/json' } }); if (r.status >= 400) throw new Error('HTTP ' + r.status); return typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
    const r = await fetch(url); return r.json();
  }
  async function getImage(url) {
    // as a data URL, so it can be drawn and saved
    if (Http) {
      const r = await Http.get({ url, responseType: 'blob' });
      if (r.status >= 400 || !r.data) throw new Error('HTTP ' + r.status);
      const type = (r.headers && (r.headers['Content-Type'] || r.headers['content-type'])) || 'image/jpeg';
      return `data:${type.split(';')[0]};base64,${r.data}`;
    }
    const b = await (await fetch(url)).blob();
    return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  }

  // best match from iTunes, then Deezer
  async function lookup(t) {
    const g = guess(t);
    const q = `${channelish(g.artist) ? '' : g.artist} ${g.title}`.trim();
    if (!q) return null;
    const cands = [];
    try {
      const r = await getJson(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${encodeURIComponent(q)}`);
      for (const x of (r && r.results) || []) cands.push({ title: x.trackName, artist: x.artistName, album: x.collectionName, art: String(x.artworkUrl100 || '').replace(/100x100bb/, '1000x1000bb'), dur: (x.trackTimeMillis || 0) / 1000 });
    } catch {}
    if (!cands.length) {
      try {
        const r = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=8`);
        for (const x of (r && r.data) || []) cands.push({ title: x.title, artist: x.artist && x.artist.name, album: x.album && x.album.title, art: x.album && (x.album.cover_xl || x.album.cover_big), dur: x.duration || 0 });
      } catch {}
    }
    let best = null, bestScore = 0;
    for (const c of cands) {
      if (!c.art) continue;
      const ts = Math.max(overlap(g.title, c.title), overlap(c.title, g.title) * 0.9);
      const as = channelish(g.artist) ? Math.max(overlap(c.artist, t.title), overlap(c.artist, t.artist) * 0.8, 0.5) : Math.max(overlap(g.artist, c.artist), overlap(c.artist, g.artist), overlap(c.artist, t.title));
      const dd = t.duration && c.dur ? Math.abs(t.duration - c.dur) : 0;
      const dur = !t.duration || !c.dur ? 0.5 : dd < 8 ? 1 : dd < 40 ? 0.6 : 0.2; // music videos run longer than the song
      const score = ts * 0.55 + as * 0.3 + dur * 0.15;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best && bestScore >= 0.62 ? { ...best, score: bestScore } : null;
  }

  // ---------- image work ----------
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  // finds the picture inside black (or flat) bars
  function contentBox(img) {
    const w = 160, h = Math.max(1, Math.round(160 * img.naturalHeight / img.naturalWidth));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const lum = (x, y) => { const i = (y * w + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
    const darkCol = (x) => { let n = 0; for (let y = 0; y < h; y++) if (lum(x, y) < 28) n++; return n / h > 0.78; };
    const darkRow = (y) => { let n = 0; for (let x = 0; x < w; x++) if (lum(x, y) < 28) n++; return n / w > 0.9; };
    let l = 0, r = w - 1, t = 0, b = h - 1;
    while (l < w / 2 && darkCol(l)) l++;
    while (r > w / 2 && darkCol(r)) r--;
    while (t < h / 2 && darkRow(t)) t++;
    while (b > h / 2 && darkRow(b)) b--;
    const sx = img.naturalWidth / w, sy = img.naturalHeight / h;
    // trim a hair more so no dark edge is left
    return { x: (l + (l ? 1 : 0)) * sx, y: (t + (t ? 1 : 0)) * sy, w: (r - l + 1 - (l ? 2 : 0)) * sx, h: (b - t + 1 - (t ? 2 : 0)) * sy };
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  async function makeSquare(src) {
    const img = await load(src);
    const box = contentBox(img);
    const c = document.createElement('canvas'); c.width = c.height = SIZE;
    const g = c.getContext('2d');
    const ratio = box.w / box.h;
    if (ratio > 0.86 && ratio < 1.16) {
      // (nearly) square picture inside the bars: that's the cover, use it
      const s = Math.min(box.w, box.h);
      g.drawImage(img, box.x + (box.w - s) / 2, box.y + (box.h - s) / 2, s, s, 0, 0, SIZE, SIZE);
    } else {
      // a real video frame: blurred backdrop, then the whole frame on top
      g.filter = 'blur(28px) saturate(1.4) brightness(.62)';
      const s = Math.min(box.w, box.h);
      g.drawImage(img, box.x + (box.w - s) / 2, box.y + (box.h - s) / 2, s, s, -40, -40, SIZE + 80, SIZE + 80);
      g.filter = 'none';
      const grad = g.createLinearGradient(0, 0, 0, SIZE); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,.35)');
      g.fillStyle = grad; g.fillRect(0, 0, SIZE, SIZE);
      const pad = 34, fw = SIZE - pad * 2, fh = Math.min(SIZE - pad * 2, fw / ratio);
      const fy = (SIZE - fh) / 2;
      g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
      roundRect(g, pad, fy, fw, fh, 14); g.fillStyle = '#000'; g.fill(); g.restore();
      g.save(); roundRect(g, pad, fy, fw, fh, 14); g.clip();
      g.drawImage(img, box.x, box.y, box.w, box.h, pad, fy, fw, fh);
      g.restore();
    }
    return c.toDataURL('image/jpeg', 0.9);
  }
  async function resizeSquare(src) {
    const img = await load(src);
    const c = document.createElement('canvas'); c.width = c.height = SIZE;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SIZE, SIZE);
    return c.toDataURL('image/jpeg', 0.9);
  }

  // ---------- fix one song ----------
  const isWeb = (t) => t.source && !['local', 'Friend', 'friend'].includes(t.source);
  async function fix(t, { force = false } = {}) {
    if (!t || (!force && (t.artV || 0) >= VERSION)) return false;
    const patch = { artV: VERSION };
    try {
      const m = isWeb(t) || channelish(t.artist) || !t.cover ? await lookup(t) : null;
      if (m) {
        const data = await resizeSquare(await getImage(m.art));
        const saved = await native.library.saveCover(t.id, data);
        if (saved) patch.cover = saved;
        // the real names, when the title was a YouTube-style one
        const g = guess(t);
        if (!t.origTitle) { patch.origTitle = t.title; patch.origArtist = t.artist; }
        if (m.score >= 0.75) {
          if (overlap(g.title, m.title) >= 0.6) patch.title = m.title;
          if (channelish(t.artist) || /\s[-–—]\s/.test(t.title)) patch.artist = m.artist;
        }
        if (!t.album || /^(downloads|youtube|soundcloud|web|generic|spotify downloads)$/i.test(t.album)) patch.album = m.album;
      } else if (t.cover) {
        const img = await load(native.fileUrl(t.cover));
        const square = Math.abs(img.naturalWidth - img.naturalHeight) < 4;
        if (!square || isWeb(t)) {
          const data = await makeSquare(native.fileUrl(t.cover));
          const saved = await native.library.saveCover(t.id, data);
          if (saved) patch.cover = saved;
        }
      }
    } catch (e) { console.warn('artwork', t.title, e); }
    if (!State.anyTrack(t.id)) return false;
    State.updateTrack(t.id, patch);
    State.emit('library');
    if (Player.current && Player.current.id === t.id) { try { App.refreshNowPlaying(); } catch {} refreshLockScreen(); }
    return !!patch.cover;
  }
  let artUrl = null;
  async function refreshLockScreen() {
    const t = Player.current;
    if (!t || !('mediaSession' in navigator) || !t.cover) return;
    try {
      const b = await (await fetch(native.fileUrl(t.cover))).blob();
      if (artUrl) URL.revokeObjectURL(artUrl);
      artUrl = URL.createObjectURL(b);
      if (Player.current && Player.current.id === t.id) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: [{ src: artUrl, sizes: '600x600', type: b.type || 'image/jpeg' }] });
    } catch {}
  }

  // ---------- a queue, so it never slows the app down ----------
  const queue = [];
  let busy = false;
  function enqueue(t, opts) { if (t && !queue.some((x) => x.t.id === t.id)) queue.push({ t, opts }); pump(); }
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { t, opts } = queue.shift();
      await fix(State.anyTrack(t.id) || t, opts);
      await new Promise((r) => setTimeout(r, 250));
    }
    busy = false;
  }
  function fixAll(force = false) {
    const list = State.allTracks().filter((t) => force || (t.artV || 0) < VERSION);
    list.forEach((t) => enqueue(t, { force }));
    return list.length;
  }

  function init() {
    // new downloads
    native.dl.onFile(({ track }) => setTimeout(() => enqueue(State.anyTrack(track.id) || track), 600));
    // the songs you already have, a little after start
    setTimeout(() => fixAll(false), 4000);
  }

  return { init, fix, fixAll, lookup, makeSquare, guess, get pending() { return queue.length; } };
})();

(function () {
  const boot = App.boot;
  App.boot = async () => { await boot(); try { Artwork.init(); } catch (e) { console.error(e); } };
})();
