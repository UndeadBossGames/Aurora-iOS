// Aurora for iPhone: when does the app need re-signing with Sideloadly?
// Apps installed with a free Apple ID stop opening 7 days after they were signed. The exact moment
// is in the app's own provisioning profile (read natively, see AuroraAudioPlugin.signing), so this
// shows a live countdown: on Home when it's getting close, in the side menu and in Settings, and it
// can remind you with notifications a day and a few hours before.
const Signing = (() => {
  const Cap = window.Capacitor || {};
  const plug = Cap.registerPlugin ? Cap.registerPlugin('AuroraAudio') : null;
  const listeners = [];
  let info = null;   // { ok, expires, created, team, profile, free }

  const left = () => (info && info.ok ? info.expires - Date.now() : Infinity);
  const level = () => { const l = left(); return l <= 0 ? 'expired' : l < 864e5 ? 'urgent' : l < 3 * 864e5 ? 'soon' : 'ok'; };
  function fmt(ms, long = false) {
    if (!isFinite(ms)) return '';
    if (ms <= 0) return long ? 'Expired' : '0m';
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
    if (long) {
      const parts = d ? [[d, 'day'], [h, 'hour']] : h ? [[h, 'hour'], [m, 'minute']] : [[m, 'minute'], [s, 'second']];
      return parts.filter(([n], i) => n || i === 0).map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`).join(' ');
    }
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s}s`;
  }
  const when = () => (info && info.ok ? new Date(info.expires).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const remindOn = () => State.settings().resignReminders !== false;

  async function load() {
    if (!plug || !plug.signing) return;
    try { info = await plug.signing(); } catch { info = null; }
    if (info && info.ok && remindOn() && plug.remind) plug.remind({ expires: info.expires, ask: false }).catch(() => {});
    listeners.forEach((f) => { try { f(); } catch {} });
    paint();
  }

  // the little live labels (side menu, banner, settings)
  function paint() {
    if (!info || !info.ok) { $$('[data-signing]').forEach((n) => (n.hidden = true)); return; }
    const l = left(), lv = level();
    $$('[data-signing]').forEach((n) => {
      n.hidden = n.dataset.signing === 'banner' && lv === 'ok';
      n.dataset.level = lv;
      const t = n.querySelector('[data-signing-time]');
      if (t) t.textContent = t.dataset.signingTime === 'long' ? fmt(l, true) : fmt(l);
    });
  }
  setInterval(paint, 1000);

  // the ring that drains as the week runs out
  function ring(size = 120) {
    const total = info && info.created ? info.expires - info.created : 7 * 864e5;
    const f = Math.max(0, Math.min(1, left() / total));
    const r = size / 2 - 8, c = 2 * Math.PI * r;
    return `<svg class="sg-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/></svg>`;
  }

  function sheet() {
    if (!info || !info.ok) { UI.toast('This copy of Aurora doesn\'t expire.'); return; }
    const lv = level();
    const head = `<div class="sg-head" data-signing="sheet" data-level="${lv}">
      <div class="sg-ring-wrap">${ring(132)}<div class="sg-ring-t"><b data-signing-time="short">${esc(fmt(left()))}</b><span>left</span></div></div>
      <h3>${lv === 'expired' ? 'Aurora needs re-signing' : 'Re-sign Aurora before it expires'}</h3>
      <p>${lv === 'expired' ? 'Re-install it with Sideloadly to keep using it.' : `It stops opening ${esc(when())}.`} Re-signing keeps all your music, playlists and settings.</p>
    </div>`;
    SpotUI.sheet([
      { icon: 'bell', round: true, label: remindOn() ? 'Reminders are on' : 'Remind me before it expires', sub: 'A notification a day before, and 3 hours before', on: remindOn(), action: toggleRemind },
      { icon: 'laptop', round: true, label: 'How to re-sign', sub: 'Takes about a minute with your PC', action: howTo },
      { icon: 'external', round: true, label: 'Get Sideloadly', sub: 'sideloadly.io', action: () => native.shell.openExternal('https://sideloadly.io') },
    ], { head, cls: 'sg-sheet' });
    paint();
  }
  async function toggleRemind() {
    const on = !remindOn();
    State.setSetting('resignReminders', on);
    if (!plug || !info || !info.ok) return;
    if (on) {
      const r = await plug.remind({ expires: info.expires, ask: true }).catch(() => ({ ok: false }));
      if (r && r.ok) UI.toast('Aurora will remind you before it expires');
      else { State.setSetting('resignReminders', false); UI.toast(r && r.denied ? 'Notifications are off for Aurora. Turn them on in iOS Settings → Aurora.' : 'Couldn\'t turn on reminders'); }
    } else {
      await plug.remind({ expires: 0 }).catch(() => {});
      UI.toast('Reminders off');
    }
  }
  function howTo() {
    SpotUI.sheet([
      { icon: 'laptop', label: '1. Plug your iPhone into your PC', sub: 'Unlock it and tap Trust if asked' },
      { icon: 'download', label: '2. Open Sideloadly', sub: 'Drag in the newest Aurora-iOS .ipa (or the same one again)' },
      { icon: 'user', label: '3. Enter the same Apple ID as before', sub: 'Then press Start. Your library stays.' },
      { icon: 'check', label: '4. Done: you get another 7 days', sub: 'The countdown resets the next time you open Aurora' },
    ].map((x) => ({ ...x, action: () => {} })), { title: 'Re-sign with Sideloadly' });
  }

  // ---- where it shows up ----
  function banner() {
    const b = html(`<button class="sg-banner" data-signing="banner" hidden>
      <span class="sg-b-ic">${icon('warning', 20)}</span>
      <span class="sg-b-t"><b>Aurora expires in <span data-signing-time="short"></span></b><small>Re-sign with Sideloadly to keep using it</small></span>
      ${icon('chevronRight', 18)}
    </button>`);
    b.onclick = sheet;
    return b;
  }
  function settingsCard() {
    const c = html(`<button class="sg-card" data-signing="settings" hidden>
      <div class="sg-card-ring">${ring(56)}</div>
      <div class="sg-card-t"><b>App signing</b><span>Expires in <span data-signing-time="long"></span></span><small>Re-sign with Sideloadly before it runs out</small></div>
      ${icon('chevronRight', 18)}
    </button>`);
    c.onclick = sheet;
    return c;
  }

  function install() {
    // Home: a banner when there are less than 3 days left
    const home = Views.home;
    if (home && !home.__sg) {
      const r = home.render;
      Views.home = Object.assign(Object.create(home), home, {
        __sg: true,
        render(root, ...a) { const out = r.call(this, root, ...a); root.prepend(banner()); paint(); return out; },
      });
    }
    // Settings: always at the top
    const set = Views.settings;
    if (set && !set.__sg) {
      const r = set.render;
      Views.settings = Object.assign(Object.create(set), set, {
        __sg: true,
        render(root, ...a) { const out = r.call(this, root, ...a); root.prepend(settingsCard()); paint(); return out; },
      });
    }
    load();
    // a re-sign gives a new expiry: check again whenever the app comes back
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
  }

  return { install, load, sheet, paint, fmt, get info() { return info; }, onChange: (f) => listeners.push(f), level };
})();
