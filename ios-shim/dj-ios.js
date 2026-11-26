// Aurora for iPhone: the AI DJ (opt in under Personalize).
// Builds a mix from your library in little themed runs (an artist you love, songs you haven't
// heard in a while, fresh downloads, favorites...) and talks between them like a radio host:
// what's coming up, why it picked it, a fact about the song (from Last.fm when connected).
// The voice is iOS's most natural installed voice (Premium/Enhanced Siri-quality voices), or an
// ultra-realistic ElevenLabs voice with your own key. It speaks over the start of the song while
// the music dips, and keeps working with the app closed (the lines travel with the queue).
const DJ = (() => {
  const Cap = window.Capacitor || {};
  const plug = Cap.registerPlugin ? Cap.registerPlugin('AuroraAudio') : null;
  const Http = (Cap.Plugins || {}).CapacitorHttp;
  const FS = (Cap.Plugins || {}).Filesystem;
  const S = () => State.settings();
  const on = () => !!S().djOn;
  const intros = new Map();   // track id -> { intro, introAudio }
  let mix = null;              // { ids, segments: [{ start, end, theme, line }] }
  let savedShuffle = null;
  const EL_VOICES = [['pNInz6obpgDQGcFmaJgB', 'Adam', 'Deep, warm, radio-style'], ['21m00Tcm4TlvDq8ikWAM', 'Rachel', 'Calm and friendly'], ['nPczCjzI2devNBz1zQrb', 'Brian', 'Smooth late-night host'], ['EXAVITQu4vr4xnSDxMaL', 'Sarah', 'Bright and upbeat'], ['TX3LPaxmHKxFdv7VOQHJ', 'Liam', 'Energetic, young']];
  const FREQ = { rare: 6, some: 3, often: 2 };

  // ---------------------------------------------------------------- library knowledge
  const plays = (id) => (State.S.p.plays || {})[id] || 0;
  const history = () => State.prefs().spHistory || [];
  function lastPlayed() { const m = new Map(); for (const h of history()) m.set(h.id, Math.max(m.get(h.id) || 0, h.at || 0)); return m; }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const ago = (ts) => { const d = (Date.now() - ts) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 7 ? `${Math.round(d)} days ago` : d < 30 ? `${Math.round(d / 7)} week${d < 14 ? '' : 's'} ago` : d < 365 ? `${Math.round(d / 30)} month${d < 60 ? '' : 's'} ago` : 'over a year ago'; };
  const firstName = () => String((State.activeProfile() || {}).name || '').split(/\s+/)[0] || 'friend';
  const clean = (s) => String(s || '').replace(/\s*[([][^)\]]*(official|video|audio|lyric|visuali|m\/?v|4k|hd)[^)\]]*[)\]]/gi, '').trim();
  const realArtist = (t) => (t.artist && t.artist !== 'Unknown artist' ? t.artist : '');

  // ---------------------------------------------------------------- the mix
  function build() {
    const all = State.allTracks().filter((t) => t.kind !== 'video' && (t.duration || 60) > 45);
    if (all.length < 3) return null;
    const lp = lastPlayed(), now = Date.now();
    const used = new Set();
    const fresh = (t) => !used.has(t.id) && now - (lp.get(t.id) || 0) > 2 * 36e5;
    const segs = [];
    const take = (list, n, theme, line) => {
      const ids = list.filter(fresh).slice(0, n).map((t) => t.id);
      if (ids.length < Math.min(2, n)) return;
      ids.forEach((id) => used.add(id));
      segs.push({ ids, theme, line });
    };
    // favorites by artist
    const byArtist = new Map();
    for (const t of all) { const a = realArtist(t); if (!a) continue; if (!byArtist.has(a)) byArtist.set(a, []); byArtist.get(a).push(t); }
    const artistScore = (a) => byArtist.get(a).reduce((n, t) => n + plays(t.id) + (State.isLiked(t.id) ? 4 : 0), 0);
    const topArtists = [...byArtist.keys()].filter((a) => byArtist.get(a).length >= 2).sort((a, b) => artistScore(b) - artistScore(a));
    const liked = shuffle(all.filter((t) => State.isLiked(t.id)));
    const forgotten = shuffle(all.filter((t) => lp.has(t.id) && now - lp.get(t.id) > 21 * 864e5));
    const neverPlayed = shuffle(all.filter((t) => !plays(t.id)));
    const recent = all.filter((t) => now - (t.addedAt || 0) < 14 * 864e5).sort((a, b) => b.addedAt - a.addedAt);
    const heavy = all.slice().sort((a, b) => plays(b.id) - plays(a.id)).slice(0, 40);
    const plans = [
      () => { const a = topArtists.find((x) => byArtist.get(x).some(fresh)); if (a) take(shuffle(byArtist.get(a).slice()), 3, 'artist', { artist: a }); },
      () => take(liked, 3, 'liked'),
      () => take(forgotten, 3, 'rediscover'),
      () => take(recent, 3, 'new'),
      () => take(shuffle(heavy.slice()), 3, 'heavy'),
      () => take(neverPlayed, 2, 'unplayed'),
      () => { const a = shuffle(topArtists.slice(1, 12)).find((x) => byArtist.get(x).some(fresh)); if (a) take(shuffle(byArtist.get(a).slice()), 2, 'artist', { artist: a }); },
    ];
    for (let round = 0; round < 4 && used.size < 45; round++) for (const p of shuffle(plans.slice())) p();
    // anything left: a little shuffle so the mix never runs dry
    const rest = shuffle(all.filter((t) => !used.has(t.id))).slice(0, Math.max(0, 50 - used.size));
    for (let i = 0; i < rest.length; i += 3) segs.push({ ids: rest.slice(i, i + 3).map((t) => t.id), theme: 'mix' });
    const ids = [];
    segs.forEach((s) => { s.start = ids.length; ids.push(...s.ids); s.end = ids.length; });
    return { ids, segments: segs };
  }

  // ---------------------------------------------------------------- what the DJ says
  function lineFor(seg, i, facts) {
    const t = State.track(seg.ids[0]);
    if (!t) return '';
    const title = clean(t.title), artist = realArtist(t);
    const by = artist ? ` by ${artist}` : '';
    const h = new Date().getHours();
    const greet = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late night vibes';
    const fact = facts ? factLine(facts) : '';
    const opener = i === 0 ? pick([
      `${greet}, ${firstName()}! It's your Aurora DJ. I've lined up a mix from your library, so sit back.`,
      `Hey ${firstName()}, your DJ here. ${greet}. I pulled together some songs I think you'll love.`,
      `${greet}, ${firstName()}. Let's get into it, I've got a fresh mix just for you.`,
    ]) + ' ' : '';
    let body = '';
    switch (seg.theme) {
      case 'artist': {
        const n = State.allTracks().filter((x) => x.artist === seg.line.artist).reduce((s, x) => s + plays(x.id), 0);
        body = pick([
          `Here's a run of ${seg.line.artist}, ${n > 5 ? `you've played them ${n} times` : 'one of your favorites'}. Starting with ${title}.`,
          `You can't get enough of ${seg.line.artist}, so here's a few in a row. First up, ${title}.`,
          `Let's spend a few songs with ${seg.line.artist}. Kicking off with ${title}.`,
        ]);
        break;
      }
      case 'liked': body = pick([`Now some songs you've hearted. ${title}${by}.`, `Straight from your Favorites: ${title}${by}.`, `A few you've told me you love. Here's ${title}.`]); break;
      case 'rediscover': {
        const when = lastPlayed().get(t.id);
        body = pick([`Let's dig into some songs you haven't played in a while. You last heard ${title} ${when ? ago(when) : 'a while back'}.`, `Throwback time. Remember ${title}${by}? It's been ${when ? ago(when).replace(' ago', '') : 'a while'}.`, `Something you might've forgotten about: ${title}${by}.`]);
        break;
      }
      case 'new': body = pick([`Fresh in your library: ${title}${by}, added ${ago(t.addedAt || Date.now())}.`, `Here's some of your newest downloads, starting with ${title}.`, `New stuff! You just added ${title}${by}.`]); break;
      case 'heavy': body = pick([`On heavy rotation lately: ${title}${by}.`, `The songs you keep coming back to. ${title}.`, `Your most played, coming right up. ${title}${by}.`]); break;
      case 'unplayed': body = pick([`Here's one you haven't actually played yet: ${title}${by}. Let's fix that.`, `Something new to your ears, even though it's in your library. ${title}.`]); break;
      default: body = pick([`Keeping it going with ${title}${by}.`, `Up next, ${title}${by}.`, `Here's ${title}.`, `Let's switch it up. ${title}${by}.`]);
    }
    return (opener + body + (fact ? ' ' + fact : '')).replace(/\s+/g, ' ').trim();
  }
  function factLine(f) {
    const out = [];
    if (f.summary) out.push(f.summary);
    else if (f.listeners > 100000) out.push(pick([`Over ${fmtBig(f.listeners)} people have this one on Last.fm.`, `This has more than ${fmtBig(f.listeners)} listeners on Last.fm.`]));
    if (f.tag && Math.random() < 0.5) out.push(`Very ${f.tag}.`);
    return out.join(' ');
  }
  const fmtBig = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : `${Math.round(n / 1000)} thousand`);

  // which songs get a line (segment starts), depending on how chatty the DJ is
  async function writeLines() {
    intros.clear();
    if (!mix) return;
    const every = FREQ[S().djTalk || 'some'] || 3;
    let since = every;
    for (let i = 0; i < mix.segments.length; i++) {
      const seg = mix.segments[i];
      if (i > 0 && since < every && seg.theme === 'mix') { since += seg.ids.length; continue; }
      since = seg.ids.length;
      seg.speak = true;
      intros.set(seg.ids[0], { intro: lineFor(seg, i, null) });
    }
    // facts from Last.fm (when connected) for the next few lines, then the ElevenLabs recordings
    const first = mix.segments.filter((s) => s.speak).slice(0, 6);
    for (const [i, seg] of first.entries()) {
      const t = State.track(seg.ids[0]);
      if (!t || typeof Connect === 'undefined' || !Connect.trackFacts) continue;
      try {
        const f = await Connect.trackFacts(t);
        if (f && mix && mix.segments.includes(seg)) intros.set(seg.ids[0], { intro: lineFor(seg, mix.segments.indexOf(seg), f) });
      } catch {}
      if (i === 1) refreshQueue();
    }
    refreshQueue();
    recordAhead();
  }

  // ---------------------------------------------------------------- ElevenLabs (optional)
  const elKey = () => String(S().elevenKey || '').trim();
  async function record(text, id) {
    if (!elKey() || !Http || !FS) return null;
    const voice = S().elevenVoice || EL_VOICES[0][0];
    const r = await Http.post({
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      headers: { 'xi-api-key': elKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      data: { text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } },
      responseType: 'arraybuffer',
    });
    if (r.status >= 300) throw new Error(r.status === 401 ? 'Your ElevenLabs key was rejected' : `ElevenLabs error ${r.status}`);
    const b64 = typeof r.data === 'string' ? r.data : btoa(String.fromCharCode(...new Uint8Array(r.data)));
    const path = `aurora-dj/${id}-${Date.now().toString(36)}.mp3`;
    await FS.writeFile({ path, data: b64, directory: 'CACHE', recursive: true });
    const { uri } = await FS.getUri({ path, directory: 'CACHE' });
    return uri;
  }
  let recording = false;
  async function recordAhead() {
    if (!elKey() || recording || !mix) return;
    recording = true;
    try {
      const pos = Math.max(0, mix.ids.indexOf(Player.P.current));
      for (const [id, v] of intros) {
        if (v.introAudio || mix.ids.indexOf(id) < pos || mix.ids.indexOf(id) > pos + 12) continue;
        try { v.introAudio = await record(v.intro, id); } catch (e) { console.warn('DJ voice', e); UI.toast(String(e.message || e)); break; }
      }
      refreshQueue();
    } finally { recording = false; }
  }

  // ---------------------------------------------------------------- playing the DJ
  function refreshQueue() { if (typeof NativeAudio !== 'undefined' && NativeAudio.refresh) NativeAudio.refresh(); }
  function introFor(id) {
    if (!on() || !isActive()) return null;
    return intros.get(id) || null;
  }
  const isActive = () => !!(Player.P.context && Player.P.context.key === 'dj');

  async function start() {
    if (!on()) { UI.toast('Turn on the DJ in Personalize first'); return; }
    mix = build();
    if (!mix) { UI.toast('Download a few more songs and the DJ can put a mix together'); return; }
    if (savedShuffle === null) savedShuffle = Player.P.shuffle;
    Player.P.shuffle = false;   // the DJ's order matters (the runs, the talk)
    await applyVoice();
    intros.clear();
    const opening = lineFor(mix.segments[0], 0, null);
    intros.set(mix.ids[0], { intro: opening });
    mix.segments[0].speak = true;
    Player.playContext({ key: 'dj', name: 'DJ' }, mix.ids, 0);
    SpotUI.haptic('medium');
    writeLines();
  }
  // "Switch it up": jump to the next run, with a new line
  function next() {
    if (!mix || !isActive()) return start();
    const pos = Player.P.pos;
    const seg = mix.segments.find((s) => s.start > pos);
    if (!seg) return start();
    if (!intros.get(seg.ids[0])) intros.set(seg.ids[0], { intro: lineFor(seg, 1, null) });
    Player.P.pos = seg.start - 1;
    Player.next();
    SpotUI.haptic('medium');
  }
  async function applyVoice() { if (plug && plug.djVoice) await plug.djVoice({ voice: S().djVoice || '', rate: S().djRate || 0.52 }).catch(() => {}); }

  // leaving the DJ (playing something else) gives you your shuffle setting back
  Player.on('track', () => {
    if (!isActive() && savedShuffle !== null) { Player.P.shuffle = savedShuffle; savedShuffle = null; }
    if (isActive()) recordAhead();
  });

  // ---------------------------------------------------------------- Home card + Now Playing button
  function card() {
    const c = html(`<button class="dj-card" data-dj-card>
      <div class="dj-orb"><i class="r1"></i><i class="r2"></i><i class="r3"></i><b>DJ</b></div>
      <div class="dj-card-t"><small>Aurora DJ</small><b>Your very own DJ</b><span>${isActive() ? 'Playing now · tap to switch it up' : 'A mix of your music, with someone to talk you through it'}</span></div>
      <span class="dj-card-play">${icon(isActive() ? 'next' : 'play', 22)}</span>
    </button>`);
    c.onclick = () => (isActive() ? next() : start());
    return c;
  }

  // ---------------------------------------------------------------- settings (in Personalize)
  async function settingsSection() {
    const s = S();
    const el = html(`<section class="pz-sec dj-set">
      <h2>AI DJ</h2><p>A mix of your library with a host who talks between songs. Off by default.</p>
      <div class="pz-list">
        <label class="pz-row"><span><b>AI DJ</b><small>Show the DJ on Home and let it talk</small></span><input type="checkbox" class="toggle dj-on" ${s.djOn ? 'checked' : ''} /></label>
        <div class="dj-more" ${s.djOn ? '' : 'hidden'}>
          <button class="pz-row dj-voice-btn"><span><b>Voice</b><small class="dj-voice-name">Best voice on this iPhone</small></span>${icon('chevronRight', 18)}</button>
          <div class="pz-row dj-talk"><span><b>How often the DJ talks</b></span><div class="sdl-q-chips"><button data-v="rare">Rarely</button><button data-v="some">Sometimes</button><button data-v="often">Often</button></div></div>
          <button class="pz-row dj-el-btn"><span><b>Ultra-realistic voice</b><small>${elKey() ? 'ElevenLabs connected' : 'Optional: use an ElevenLabs voice with your own key'}</small></span>${icon('chevronRight', 18)}</button>
          <button class="pz-row dj-test"><span><b>Hear the DJ</b><small>Plays a sample line</small></span>${icon('play', 18)}</button>
        </div>
      </div>
    </section>`);
    $('.dj-on', el).onchange = (e) => { State.setSetting('djOn', e.target.checked); $('.dj-more', el).hidden = !e.target.checked; SpotUI.haptic('select'); if (e.target.checked) UI.toast('The DJ is on Home now'); };
    const chips = $$('.dj-talk button', el);
    chips.forEach((b) => { b.classList.toggle('on', (s.djTalk || 'some') === b.dataset.v); b.onclick = () => { State.setSetting('djTalk', b.dataset.v); chips.forEach((x) => x.classList.toggle('on', x === b)); if (isActive()) writeLines(); }; });
    $('.dj-voice-btn', el).onclick = voiceSheet;
    $('.dj-el-btn', el).onclick = elevenSheet;
    $('.dj-test', el).onclick = test;
    voiceName().then((n) => { const x = $('.dj-voice-name', el); if (x) x.textContent = n; });
    return el;
  }
  async function voiceList() { try { return (await plug.voices()).voices || []; } catch { return []; } }
  async function voiceName() {
    if (elKey()) return `ElevenLabs · ${(EL_VOICES.find((v) => v[0] === S().elevenVoice) || EL_VOICES[0])[1]}`;
    const vs = await voiceList();
    const v = vs.find((x) => x.id === S().djVoice) || vs[0];
    return v ? `${v.name}${v.quality !== 'default' ? ` (${v.quality === 'premium' ? 'Premium' : 'Enhanced'})` : ''}` : 'Best voice on this iPhone';
  }
  async function voiceSheet() {
    const vs = await voiceList();
    const good = vs.filter((v) => v.quality !== 'default');
    const list = (good.length ? good : vs).slice(0, 14);
    SpotUI.sheet([
      ...list.map((v) => ({ icon: 'mic', label: `${v.name}${v.quality === 'premium' ? ' · Premium' : v.quality === 'enhanced' ? ' · Enhanced' : ''}`, sub: v.lang.replace('en-', 'English · '), on: (S().djVoice || (vs[0] && vs[0].id)) === v.id, action: async () => { State.setSetting('djVoice', v.id); await applyVoice(); test(); } })),
      { divider: true },
      { icon: 'download', label: 'Get more natural voices', sub: good.some((v) => v.quality === 'premium') ? 'You have Premium voices installed' : 'iOS Settings → Accessibility → Spoken Content → Voices → English → pick one marked "Premium"', action: () => {} },
    ], { title: 'DJ voice' });
  }
  function elevenSheet() {
    const body = html(`<div class="dj-el">
      <p>ElevenLabs voices sound like a real radio host. Make a free account at elevenlabs.io (the free plan covers a lot of DJ lines), copy your API key from your profile, and paste it here. It's stored only on this iPhone.</p>
      <input class="dj-el-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ElevenLabs API key" value="${esc(S().elevenKey || '')}" />
      <div class="dj-el-voices">${EL_VOICES.map(([id, n, d]) => `<button data-id="${id}" class="${(S().elevenVoice || EL_VOICES[0][0]) === id ? 'on' : ''}"><b>${n}</b><small>${d}</small></button>`).join('')}</div>
      <div class="dj-el-btns"><button class="sp-pill dj-el-get">Get a key</button><button class="sp-pill dj-el-off">Use the iPhone voice</button><button class="sdl-go dj-el-save">Save</button></div>
    </div>`);
    let voice = S().elevenVoice || EL_VOICES[0][0];
    $$('.dj-el-voices button', body).forEach((b) => b.onclick = () => { voice = b.dataset.id; $$('.dj-el-voices button', body).forEach((x) => x.classList.toggle('on', x === b)); });
    const sheet = SpotUI.sheet([], { title: 'Ultra-realistic voice', head: '' });
    $('.sp-sheet-items', sheet).appendChild(body);
    $('.dj-el-get', body).onclick = () => native.shell.openExternal('https://elevenlabs.io/app/settings/api-keys');
    $('.dj-el-off', body).onclick = () => { State.setSetting('elevenKey', ''); SpotUI.closeSheet(); UI.toast('Using the iPhone voice'); };
    $('.dj-el-save', body).onclick = async () => {
      State.setSetting('elevenKey', $('.dj-el-key', body).value.trim());
      State.setSetting('elevenVoice', voice);
      SpotUI.closeSheet();
      if (elKey()) { UI.toast('Testing your ElevenLabs voice…'); test(); }
    };
  }
  async function test() {
    await applyVoice();
    const t = Player.current || State.allTracks()[0];
    const text = t ? `Hey ${firstName()}, it's your Aurora DJ. Coming up, ${clean(t.title)}${realArtist(t) ? ' by ' + realArtist(t) : ''}. Let's go.` : `Hey ${firstName()}, it's your Aurora DJ. Let's play some music.`;
    try {
      let audio = '';
      if (elKey()) audio = (await record(text, 'test')) || '';
      await plug.speak({ text, audio, duck: true });
    } catch (e) { UI.toast(String(e.message || e)); }
  }

  function install() {
    // Home: the DJ card at the top
    const home = Views.home;
    if (home && !home.__dj) {
      const r = home.render;
      Views.home = Object.assign(Object.create(home), home, {
        __dj: true,
        render(root, ...a) {
          const out = r.call(this, root, ...a);
          if (on()) { const c = card(); const after = root.querySelector('.sg-banner'); after ? after.after(c) : root.prepend(c); }
          return out;
        },
      });
    }
    if (typeof Personalize !== 'undefined') Personalize.addSection(() => { const holder = html('<div></div>'); settingsSection().then((n) => holder.replaceWith(n)); return holder; });
    State.on('settings', (k) => { if (k === 'djOn' && App.current && App.current.view === 'home') App.render(true); if (k === 'djVoice' || k === 'djRate') applyVoice(); });
    applyVoice();
  }

  return { install, start, next, introFor, get active() { return isActive(); }, test, build };
})();
