// Aurora for iPhone, standard layout: Jam (Listen Together, the way Spotify's Jam works).
// Start a Jam, invite friends with a link or a QR code, and everyone can add songs to one shared
// queue (you see who added what). The host can let guests play, pause and skip too. Under the hood
// it's Listen Together (together.js): same song, same second, songs fetched for anyone missing them.
const SpotJam = (() => {
  const Cap = window.Capacitor || {};
  const plug = Cap.registerPlugin ? Cap.registerPlugin('AuroraAudio') : null;
  const LT = () => ListenTogether;
  const st = () => LT().state;
  const color = (n) => (typeof colorFor === 'function' ? colorFor(n) : '#8b7bff');
  const av = (m, size = 28) => `<span class="jm-av" style="width:${size}px;height:${size}px;background:${esc((m && m.color) || color((m && m.name) || '?'))}">${m && m.avatar ? `<img src="${esc(m.avatar)}" />` : esc(((m && m.name) || '?')[0].toUpperCase())}</span>`;
  const link = (code) => `aurora://together/${code}`;

  function members() {
    const s = st();
    const list = [...s.members.values()].filter((m) => m && m.name);
    return list.sort((a, b) => (b.role === 'host') - (a.role === 'host'));
  }
  function hostName() {
    const s = st();
    if (s.role === 'host') return SpotUI.me().name;
    return (s.hostState && s.hostState.host && s.hostState.host.name) || (members().find((m) => m.role === 'host') || {}).name || 'Your friend';
  }
  // what's playing and what's next, the same for host and guests
  function snapshot() {
    const s = st();
    if (s.role === 'host') {
      const t = Player.current;
      const q = Player.upNext(20).map((x) => { const q2 = State.track(x.id); return q2 && { id: q2.id, title: q2.title, artist: q2.artist, src: UI.coverSrc(q2), explicit: q2.explicit, by: s.addedBy.get(q2.id) || null, user: !!x.user }; }).filter(Boolean);
      return { track: t && { title: t.title, artist: t.artist, src: UI.coverSrc(t), explicit: t.explicit, by: s.addedBy.get(t.id) || null }, playing: Player.playing, queue: q, ctx: (Player.P.context && Player.P.context.name) || 'your library', open: s.open };
    }
    const h = s.hostState || {};
    const t = h.track;
    return {
      track: t && { title: t.title, artist: t.artist, src: t.cover || (Player.current && UI.coverSrc(Player.current)) || genCover(t.title || '', '', 'music'), explicit: t.explicit, by: h.trackBy || null },
      playing: !!h.playing,
      queue: (h.queue || []).map((q) => ({ ...q, src: q.cover || (State.allTracks().find((x) => x.title === q.title && x.artist === q.artist) ? UI.coverSrc(State.allTracks().find((x) => x.title === q.title && x.artist === q.artist)) : genCover(q.title, '', 'music')) })),
      ctx: h.ctx || `${hostName()}'s music`, open: h.open !== false,
    };
  }

  // ---------------------------------------------------------------- the page
  const view = {
    live: false,
    render(root) {
      const page = html('<div class="jm"></div>');
      root.appendChild(page);
      let raf = 0;
      const draw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!page.isConnected) return; page.innerHTML = ''; st().role ? session(page) : lobby(page); }); };
      draw();
      const off1 = LT().onChange(debounce(draw, 120));
      const t1 = () => { if (st().role === 'host') draw(); };
      Player.on('track', t1); Player.on('queue', t1); Player.on('state', t1);
      return () => { off1 && off1(); };
    },
  };

  function lobby(page) {
    const el = html(`<div class="jm-lobby">
      <div class="jm-art">
        <i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i><i class="c5"></i><i class="c6"></i>
        <span class="jm-art-badge">${icon('together', 44)}</span>
        <span class="jm-art-me">${SpotUI.avatar ? SpotUI.avatar(96) : av({ name: SpotUI.me().name }, 96)}</span>
      </div>
      <h1>Start a Jam</h1>
      <h3>Because music sounds better together.</h3>
      <p>Invite friends to listen and add songs together, in real time, from wherever they are. Everyone hears the same song at the same second.</p>
      <button class="jm-start">Start a Jam</button>
      <div class="jm-join">
        <b>Join a Jam</b>
        <div class="jm-join-row"><input class="jm-code" placeholder="LT-XXXXXX" maxlength="12" autocapitalize="characters" autocorrect="off" spellcheck="false" /><button class="jm-join-btn">Join</button></div>
        <small>Got a QR code from a friend? Scan it with your Camera app.</small>
      </div>
      <p class="jm-fine">People in the Jam see your name and picture, and songs anyone adds are downloaded for everyone who doesn't have them.</p>
    </div>`);
    $('.jm-start', el).onclick = () => { SpotUI.haptic('medium'); LT().host(); setTimeout(inviteSheet, 450); };
    const join = () => { const c = $('.jm-code', el).value; try { LT().join(c); SpotUI.haptic('medium'); } catch (e) { UI.toast(e.message); } };
    $('.jm-join-btn', el).onclick = join;
    $('.jm-code', el).addEventListener('keydown', (e) => e.key === 'Enter' && join());
    page.appendChild(el);
  }

  function session(page) {
    const s = st(), host = s.role === 'host', snap = snapshot(), ms = members();
    const shown = ms.slice(0, 3), extra = Math.max(0, ms.length - 3);
    const canCtl = host || snap.open;
    const el = html(`<div class="jm-session">
      <div class="jm-device">${icon('devices', 14)}<span>${esc(host ? (typeof NativeAudio !== 'undefined' && NativeAudio.route ? NativeAudio.route.name : 'This iPhone') : `Listening along with ${hostName()}`)}</span></div>
      <h1>${esc(hostName())}'s Jam</h1>
      <div class="jm-bar">
        <button class="jm-people">${shown.map((m) => av(m, 30)).join('')}${extra ? `<span class="jm-av more">+${extra}</span>` : ''}</button>
        <button class="jm-chip jm-invite">Invite</button>
        <button class="jm-chip jm-leave">${host ? 'End' : 'Leave'}</button>
      </div>
      ${host ? `<label class="jm-toggle"><span>Let others change what's playing</span><input type="checkbox" class="toggle" ${s.open ? 'checked' : ''} /></label>` : ''}
      ${!host ? `<div class="jm-sync ${esc(s.sync.status || '')}"><i></i><span>${esc(s.sync.note || 'Connecting…')}</span>${s.sync.status === 'paused' && !s.following ? '<button class="jm-resync">Resync</button>' : ''}</div>` : ''}
      <div class="jm-sec-head"><h2>Now playing</h2><button class="jm-add">${icon('sparkle', 16)} Add songs</button></div>
      <div class="jm-now"></div>
      <div class="jm-q"></div>
    </div>
    `);
    const now = $('.jm-now', el);
    now.appendChild(snap.track ? qrow(snap.track, true) : html('<div class="jm-empty">Nothing playing yet. Add a song to get the Jam going.</div>'));
    const q = $('.jm-q', el);
    const mine = snap.queue.filter((x) => x.user || x.by), rest = snap.queue.filter((x) => !(x.user || x.by));
    if (mine.length) { q.appendChild(html('<h3 class="jm-h3">Next in queue</h3>')); mine.forEach((x) => q.appendChild(qrow(x))); }
    if (rest.length) { q.appendChild(html(`<h3 class="jm-h3">Next from: ${esc(snap.ctx)}</h3>`)); rest.slice(0, 12).forEach((x) => q.appendChild(qrow(x))); }
    const ctl = html(`<div class="jm-controls ${canCtl ? '' : 'locked'}">
      <button data-c="prev">${icon('prev', 28)}</button>
      <button data-c="toggle" class="jm-pp">${icon(snap.playing ? 'pause' : 'play', 30)}</button>
      <button data-c="next">${icon('next', 28)}</button>
      ${canCtl ? '' : `<small>${esc(hostName())} controls playback</small>`}
    </div>`);
    $$('button', ctl).forEach((b) => b.onclick = () => { if (!canCtl) return UI.toast(`${hostName()} hasn't let others change what's playing`); SpotUI.haptic('light'); LT().control(b.dataset.c); });
    el.appendChild(ctl);
    $('.jm-invite', el).onclick = inviteSheet;
    $('.jm-people', el).onclick = peopleSheet;
    $('.jm-leave', el).onclick = () => SpotUI.sheet([{ icon: 'close', label: host ? 'End the Jam for everyone' : 'Leave the Jam', danger: true, action: () => LT().leave() }], { title: host ? 'End this Jam?' : 'Leave this Jam?' });
    const tg = $('.jm-toggle input', el); if (tg) tg.onchange = (e) => { LT().setOpen(e.target.checked); SpotUI.haptic('select'); };
    const rs = $('.jm-resync', el); if (rs) rs.onclick = () => LT().resync();
    $('.jm-add', el).onclick = addSheet;
    page.appendChild(el);
  }
  function qrow(x, playing = false) {
    return html(`<div class="jm-row ${playing ? 'playing' : ''}">
      <img src="${esc(x.src || '')}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="jm-row-t"><b>${playing ? '<span class="jm-eq"><i></i><i></i><i></i></span>' : ''}${esc(x.title)}</b><span>${x.explicit ? '<i class="explicit">E</i>' : ''}${esc(x.artist || '')}</span></div>
      ${x.by ? `<span class="jm-by" title="Added by ${esc(x.by.name || '')}">${av(x.by, 26)}</span>` : ''}
    </div>`);
  }

  // ---------------------------------------------------------------- sheets
  async function inviteSheet() {
    const code = st().code;
    if (!code) return;
    let qr = '';
    try { const r = await plug.qr({ text: link(code) }); if (r && r.ok) qr = r.src; } catch {}
    const head = `<div class="jm-inv">
      <h3>Invite friends to your Jam</h3>
      <button class="jm-share">${icon('share', 18)} Share link</button>
      <div class="jm-inv-sep"></div>
      <div class="jm-inv-row"><div><b>Scan QR code</b><span>Friends scan this with their Camera app to join the Jam.</span></div>${qr ? `<img class="jm-qr" src="${qr}" alt="QR code" />` : ''}</div>
      <div class="jm-inv-row"><div><b>Or share the code</b><span>They can type it in Aurora → Jam.</span></div><button class="jm-code-big">${esc(code)}</button></div>
    </div>`;
    const sh = SpotUI.sheet([], { head, cls: 'jm-inv-sheet' });
    $('.jm-share', sh).onclick = async () => {
      const text = `Join my Jam on Aurora! Open this on your iPhone: ${link(code)}  (or enter code ${code} in Aurora → Jam)`;
      try { if (navigator.share) await navigator.share({ title: `${hostName()}'s Jam`, text }); else { await navigator.clipboard.writeText(text); UI.toast('Invite copied'); } } catch {}
    };
    $('.jm-code-big', sh).onclick = async () => { try { await navigator.clipboard.writeText(code); UI.toast('Code copied'); } catch {} };
  }
  function peopleSheet() {
    const ms = members();
    SpotUI.sheet(ms.map((m) => ({ iconHtml: av(m, 36), label: m.name + (m.role === 'host' ? ' (host)' : ''), sub: m.role === 'host' ? 'Started the Jam' : 'Listening along', action: () => {} })), { title: `In the Jam · ${ms.length}` });
  }

  // add songs: your library first, or anything from YouTube
  function addSheet() {
    const sh = SpotUI.sheet([], { title: 'Add songs', cls: 'jm-add-sheet' });
    const body = html(`<div class="jm-add-body">
      <div class="jm-search">${icon('search', 18)}<input placeholder="Search your songs or online" autocorrect="off" spellcheck="false" /></div>
      <div class="jm-tabs"><button class="sp-chip on" data-t="lib">Your library</button><button class="sp-chip" data-t="web">Online</button></div>
      <div class="jm-add-list"></div>
    </div>`);
    $('.sp-sheet-items', sh).appendChild(body);
    const list = $('.jm-add-list', body), input = $('input', body);
    let tab = 'lib', seq = 0;
    const added = new Set();
    const row = (t, info) => {
      const r = html(`<div class="jm-row"><img src="${esc(info.src || '')}" alt="" onerror="this.style.visibility='hidden'" /><div class="jm-row-t"><b>${esc(info.title)}</b><span>${info.explicit ? '<i class="explicit">E</i>' : ''}${esc(info.artist || '')}</span></div><button class="jm-plus ${added.has(info.title + info.artist) ? 'on' : ''}">${icon(added.has(info.title + info.artist) ? 'check' : 'plus', 20)}</button></div>`);
      $('.jm-plus', r).onclick = () => {
        if (added.has(info.title + info.artist)) return;
        added.add(info.title + info.artist);
        LT().addSong(t);
        SpotUI.haptic('medium');
        $('.jm-plus', r).classList.add('on');
        $('.jm-plus', r).innerHTML = icon('check', 20);
        UI.toast(`Added "${info.title}"`);
      };
      return r;
    };
    async function draw() {
      const q = input.value.trim().toLowerCase(), my = ++seq;
      list.innerHTML = '';
      if (tab === 'lib') {
        const ts = State.allTracks().filter((t) => t.kind !== 'video' && (!q || `${t.title} ${t.artist}`.toLowerCase().includes(q))).slice(0, 60);
        if (!ts.length) list.appendChild(html('<div class="jm-empty">No songs match. Try Online.</div>'));
        ts.forEach((t) => list.appendChild(row(t, { title: t.title, artist: t.artist, src: UI.coverSrc(t), explicit: t.explicit })));
        return;
      }
      if (!q) { list.appendChild(html('<div class="jm-empty">Type a song or artist to search online.</div>')); return; }
      list.appendChild(html('<div class="cx-skel"></div><div class="cx-skel"></div><div class="cx-skel"></div>'));
      let res = [];
      try { res = typeof discoverSearch === 'function' ? await discoverSearch(q, 'youtube') : await native.dl.search(q, 'youtube', 15); } catch (e) { if (my === seq) list.innerHTML = `<div class="jm-empty">${esc(e.message)}</div>`; return; }
      if (my !== seq) return;
      list.innerHTML = '';
      res.filter((r) => r.kind === 'song').concat(res.filter((r) => r.kind !== 'song')).slice(0, 25).forEach((r) => {
        const t = { title: r.title, artist: (r.channel || '').replace(/ - Topic$/, ''), url: r.url, thumbnail: r.thumbnail, explicit: r.explicit, duration: r.duration };
        list.appendChild(row(t, { title: t.title, artist: t.artist, src: r.thumbnail, explicit: r.explicit }));
      });
    }
    $$('.jm-tabs button', body).forEach((b) => b.onclick = () => { tab = b.dataset.t; $$('.jm-tabs button', body).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    input.addEventListener('input', debounce(draw, tab === 'web' ? 500 : 120));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') draw(); });
    draw();
  }

  // a Jam link opened Aurora: ask first, like Spotify does
  function joinPrompt(code) {
    const c = LT().cleanCode(code);
    if (!c) return UI.toast('That Jam link looks broken');
    if (st().code === c) return App.go('together');
    const head = `<div class="jm-prompt"><div class="jm-prompt-art">${icon('together', 36)}</div><h3>Join this Jam?</h3><p>Listen along and add songs with your friends. Code ${esc(c)}</p></div>`;
    SpotUI.sheet([
      { icon: 'together', round: true, label: 'Join', sub: 'Hear what they hear, in sync', action: () => { try { LT().join(c); App.go('together'); } catch (e) { UI.toast(e.message); } } },
      { icon: 'close', round: true, label: 'Not now', action: () => {} },
    ], { head });
  }

  function install() {
    if ((State.settings().iosLayout || 'standard') === 'classic') return;
    Views.together = view;
  }
  return { install, joinPrompt, inviteSheet, addSheet };
})();
