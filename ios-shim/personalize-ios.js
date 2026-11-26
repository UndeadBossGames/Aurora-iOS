// Aurora for iPhone: Personalize. Make the app yours: the home-screen icon, the accent color,
// the background, the Now Playing look and which shelves Home shows. Also the home of the AI DJ
// and connected apps (Last.fm, stats.fm) settings, which those modules add as sections.
const Personalize = (() => {
  const Cap = window.Capacitor || {};
  const plug = Cap.registerPlugin ? Cap.registerPlugin('AuroraAudio') : null;
  const ACCENTS = [
    ['Aurora green', '#1ed760'], ['Mint', '#2de2c9'], ['Lavender', '#9b8bff'], ['Ocean', '#3d9bff'],
    ['Sunset', '#ff7a45'], ['Rose', '#ff5c93'], ['Gold', '#f2c14e'], ['Ruby', '#ff3b4f'], ['Lime', '#b4f03c'], ['Ice', '#e8f1ff'],
  ];
  const BACKGROUNDS = [
    ['Dark', '#121212', 'The classic'], ['Black', '#000000', 'Pure black, easy on OLED screens'], ['Midnight', '#0b1020', 'A deep blue night'], ['Plum', '#140d1c', 'A hint of purple'],
  ];
  const NP_STYLES = [['color', 'Artwork colors', 'A color from the cover fades into the background'], ['blur', 'Blurred artwork', 'The cover, softly blurred behind everything'], ['plain', 'Plain', 'Just your background color']];
  const HOME_SHELVES = ['Jump back in', 'Recents', 'Your top mixes', 'Recommended Stations', 'Your playlists', 'Recently added', 'Your favorite artists', 'Your videos', 'Artists with videos'];
  const sections = [];   // other modules add their own (DJ, connected apps)
  let icons = null;

  const S = () => State.settings();
  const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lum = (h) => { const [r, g, b] = hex2rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  // ---- apply the look everywhere ----
  function apply() {
    const s = S(), b = document.body;
    const acc = s.accent || '#1ed760';
    b.style.setProperty('--sp-green', acc);
    b.style.setProperty('--accent', acc);
    b.style.setProperty('--accent-hover', acc);
    b.style.setProperty('--sp-on-accent', lum(acc) > 0.6 ? '#000' : lum(acc) > 0.45 ? '#000' : '#fff');
    const bg = s.appBg || '#121212';
    b.style.setProperty('--sp-bg', bg);
    b.style.setProperty('--bg', bg);
    b.dataset.npStyle = s.npStyle || 'color';
    document.querySelector('meta[name=theme-color]') && document.querySelector('meta[name=theme-color]').setAttribute('content', bg);
  }

  async function loadIcons() {
    if (icons) return icons;
    try { icons = await (await fetch('ios/icons/icons.json')).json(); } catch { icons = []; }
    return icons;
  }
  async function currentIcon() {
    try { const r = await plug.getIcon(); return { supported: r.supported !== false, id: String(r.name || '').replace(/^AppIcon-/, '') || 'classic' }; } catch { return { supported: false, id: 'classic' }; }
  }

  // ---- the page ----
  const view = {
    live: false,
    async render(root) {
      const s = S();
      const el = html(`<div class="pz">
        <div class="sp-page-head"><h1>Personalize</h1><span>Make Aurora yours</span></div>
        <section class="pz-sec"><h2>App icon</h2><p>Pick the icon on your Home Screen.</p><div class="pz-icons"></div></section>
        <section class="pz-sec"><h2>Accent color</h2><p>Buttons, progress bars and highlights.</p><div class="pz-swatches"></div></section>
        <section class="pz-sec"><h2>Background</h2><div class="pz-bgs"></div></section>
        <section class="pz-sec"><h2>Now Playing</h2><div class="pz-list pz-np"></div></section>
        <section class="pz-sec"><h2>Home</h2><p>Choose which shelves show up on Home.</p><div class="pz-list pz-home"></div></section>
        <section class="pz-sec"><h2>Feel</h2><div class="pz-list pz-feel"></div></section>
        <div class="pz-more"></div>
        <button class="pz-reset">Reset to the original look</button>
      </div>`);
      root.appendChild(el);

      // icons
      const grid = $('.pz-icons', el);
      const [list, cur] = await Promise.all([loadIcons(), currentIcon()]);
      if (!cur.supported) $('.pz-icons', el).closest('.pz-sec').hidden = true;
      const paintIcons = (sel) => $$('.pz-icon', grid).forEach((b) => b.classList.toggle('on', b.dataset.id === sel));
      list.forEach((ic) => {
        const b = html(`<button class="pz-icon" data-id="${esc(ic.id)}"><img src="ios/icons/${esc(ic.id)}.png" alt="" /><span>${esc(ic.name)}</span><i>${icon('check', 14)}</i></button>`);
        b.onclick = async () => {
          if (b.classList.contains('on')) return;
          SpotUI.haptic('select');
          const r = await plug.setIcon({ name: ic.id === 'classic' ? '' : 'AppIcon-' + ic.id }).catch((e) => ({ ok: false, error: e.message }));
          if (r && r.ok) { paintIcons(ic.id); State.setSetting('appIcon', ic.id); } else UI.toast((r && r.error) || 'Couldn\'t change the icon');
        };
        grid.appendChild(b);
      });
      paintIcons(cur.id);

      // accent
      const sw = $('.pz-swatches', el);
      ACCENTS.forEach(([name, c]) => {
        const b = html(`<button class="pz-swatch" style="--c:${c}" aria-label="${esc(name)}"><span></span><small>${esc(name)}</small></button>`);
        b.classList.toggle('on', (s.accent || '#1ed760') === c);
        b.onclick = () => { SpotUI.haptic('select'); State.setSetting('accent', c); apply(); $$('.pz-swatch', sw).forEach((x) => x.classList.toggle('on', x === b)); };
        sw.appendChild(b);
      });

      // background
      const bgs = $('.pz-bgs', el);
      BACKGROUNDS.forEach(([name, c, sub]) => {
        const b = html(`<button class="pz-bg" style="--c:${c}"><span class="pz-bg-prev"><i></i><i></i><i></i></span><b>${esc(name)}</b><small>${esc(sub)}</small></button>`);
        b.classList.toggle('on', (s.appBg || '#121212') === c);
        b.onclick = () => { SpotUI.haptic('select'); State.setSetting('appBg', c); apply(); $$('.pz-bg', bgs).forEach((x) => x.classList.toggle('on', x === b)); };
        bgs.appendChild(b);
      });

      // now playing
      const np = $('.pz-np', el);
      NP_STYLES.forEach(([id, name, sub]) => {
        const b = html(`<button class="pz-row"><span><b>${esc(name)}</b><small>${esc(sub)}</small></span><i class="pz-radio"></i></button>`);
        b.classList.toggle('on', (s.npStyle || 'color') === id);
        b.onclick = () => { SpotUI.haptic('select'); State.setSetting('npStyle', id); apply(); $$('.pz-row', np).forEach((x) => x.classList.toggle('on', x === b)); };
        np.appendChild(b);
      });

      // home shelves
      const home = $('.pz-home', el);
      HOME_SHELVES.forEach((name) => {
        const on = !(s.hiddenShelves || []).includes(name);
        const b = html(`<label class="pz-row"><span><b>${esc(name)}</b></span><input type="checkbox" class="toggle" ${on ? 'checked' : ''} /></label>`);
        $('input', b).onchange = (e) => {
          const hid = new Set(S().hiddenShelves || []);
          if (e.target.checked) hid.delete(name); else hid.add(name);
          State.setSetting('hiddenShelves', [...hid]);
          SpotUI.haptic('select');
        };
        home.appendChild(b);
      });

      // feel
      const feel = $('.pz-feel', el);
      [['haptics', 'Haptic feedback', 'Little taps when you press buttons', true], ['animatedCovers', 'Moving backgrounds', 'Gentle motion on headers and the DJ', true]].forEach(([k, name, sub, def]) => {
        const on = s[k] === undefined ? def : !!s[k];
        const b = html(`<label class="pz-row"><span><b>${esc(name)}</b><small>${esc(sub)}</small></span><input type="checkbox" class="toggle" ${on ? 'checked' : ''} /></label>`);
        $('input', b).onchange = (e) => { State.setSetting(k, e.target.checked); document.body.classList.toggle('pz-still', S().animatedCovers === false); };
        feel.appendChild(b);
      });

      // DJ, connected apps...
      const more = $('.pz-more', el);
      sections.forEach((f) => { try { const n = f(); if (n) more.appendChild(n); } catch (e) { console.warn(e); } });

      $('.pz-reset', el).onclick = async () => {
        ['accent', 'appBg', 'npStyle', 'hiddenShelves'].forEach((k) => State.setSetting(k, undefined));
        apply();
        if (cur.supported) await plug.setIcon({ name: '' }).catch(() => {});
        UI.toast('Back to the original look');
        App.render(true);
      };
    },
  };

  function install() {
    Views.personalize = view;
    apply();
    State.on('settings', apply);
    document.body.classList.toggle('pz-still', S().animatedCovers === false);
    // haptics switch
    if (window.native && native.haptic) {
      const h = native.haptic.bind(native);
      native.haptic = (s) => (S().haptics === false ? Promise.resolve() : h(s));
    }
    // Settings: a big entry at the top
    const set = Views.settings;
    if (set && !set.__pz) {
      const r = set.render;
      Views.settings = Object.assign(Object.create(set), set, {
        __pz: true,
        render(root, ...a) {
          const out = r.call(this, root, ...a);
          const c = html(`<button class="pz-entry"><span class="pz-entry-ic">${icon('sparkle', 22)}</span><span><b>Personalize</b><small>App icon, colors, Home, AI DJ and connected apps</small></span>${icon('chevronRight', 18)}</button>`);
          c.onclick = () => App.go('personalize');
          root.prepend(c);
          return out;
        },
      });
    }
  }

  return { install, apply, addSection: (f) => sections.push(f), view };
})();
