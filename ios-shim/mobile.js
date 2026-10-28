// Aurora for iPhone: phone layout on top of the shared desktop UI.
// Adds a bottom tab bar, a mini player that opens into a full-screen player, a full-screen Library,
// and hides things an iPhone can't do (link downloads, Discord).
(function () {
  const body = document.body;
  const IOS_HIDDEN_VIEWS = ['downloader', 'discover', 'discord'];

  // 1) wait for the file system before the app starts
  const boot = App.boot;
  App.boot = async () => {
    try { await native.ready; } catch (e) { console.error(e); }
    await boot();
    setup();
  };

  // 2) views the iPhone can't use send you somewhere useful instead
  const go = App.go;
  App.go = (view, ...rest) => {
    if (IOS_HIDDEN_VIEWS.includes(view)) {
      UI.toast(view === 'discord' ? 'Discord Connection works in Aurora for PC.' : "Link downloads work in Aurora for PC. Copy songs to your iPhone with iTunes File Sharing or the Files app.", 4500);
      view = 'home'; rest = [];
    }
    closeSheets();
    const r = go(view, ...rest);
    syncTabs(view);
    return r;
  };

  function closeSheets() {
    body.classList.remove('show-lib');
    body.classList.remove('np-open');
  }

  // 3) bottom tab bar
  const TABS = [
    ['home', 'homeFilled', 'Home'],
    ['search', 'search', 'Search'],
    ['library', 'library', 'Library'],
    ['together', 'headphones', 'Together'],
    ['me', null, 'You'],
  ];
  function syncTabs(view) {
    const tab = body.classList.contains('show-lib') ? 'library' : view === 'search' ? 'search' : view === 'together' ? 'together' : view === 'profile' || view === 'store' || view === 'friends' || view === 'settings' ? 'me' : view === 'home' ? 'home' : '';
    document.querySelectorAll('.m-tab').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  }
  function avatar() {
    const p = State.activeProfile();
    return p ? UI.avatarHtml(p, 26) : icon('user', 24);
  }
  function renderTabs() {
    let bar = document.getElementById('m-tabs');
    if (!bar) {
      bar = document.createElement('nav');
      bar.id = 'm-tabs';
      bar.className = 'm-tabs';
      document.getElementById('app').appendChild(bar);
    }
    bar.innerHTML = TABS.map(([t, ic, label]) => `<button class="m-tab" data-t="${t}">${t === 'me' ? `<span class="m-av">${avatar()}</span>` : icon(ic, 24)}<span>${label}</span></button>`).join('');
    bar.querySelectorAll('.m-tab').forEach((b) => b.onclick = () => {
      const t = b.dataset.t;
      if (t === 'library') { body.classList.remove('np-open'); body.classList.add('show-lib'); syncTabs(); return; }
      if (t === 'me') { closeSheets(); document.getElementById('btn-hub').click(); return; }
      if (t === 'search') { App.go('search', ''); setTimeout(() => { const i = document.getElementById('search-input'); i && i.focus(); }, 60); return; }
      App.go(t);
    });
    syncTabs(App.current && App.current.view);
  }

  // 4) mini player → full-screen player
  function wirePlayer() {
    const pb = document.getElementById('playerbar');
    if (!document.getElementById('np-close')) {
      const close = document.createElement('button');
      close.id = 'np-close';
      close.className = 'np-close';
      close.innerHTML = icon('chevronDown', 28);
      close.onclick = (e) => { e.stopPropagation(); body.classList.remove('np-open'); };
      pb.prepend(close);
      const label = document.createElement('div');
      label.className = 'np-label';
      label.textContent = 'Now playing';
      pb.prepend(label);
      const mini = document.createElement('button');
      mini.id = 'm-miniplay';
      mini.className = 'm-miniplay';
      mini.onclick = (e) => { e.stopPropagation(); Player.toggle(); };
      pb.appendChild(mini);
    }
    pb.addEventListener('click', (e) => {
      if (body.classList.contains('np-open')) return;
      if (e.target.closest('button, a, .slider')) return;
      if (!Player.current) return;
      body.classList.add('np-open');
    });
    // swipe down to close
    let y0 = null;
    pb.addEventListener('touchstart', (e) => { if (body.classList.contains('np-open') && !e.target.closest('.slider')) y0 = e.touches[0].clientY; }, { passive: true });
    pb.addEventListener('touchend', (e) => { if (y0 !== null && e.changedTouches[0].clientY - y0 > 90) body.classList.remove('np-open'); y0 = null; }, { passive: true });
    const sync = () => {
      body.classList.toggle('has-track', !!Player.current);
      const m = document.getElementById('m-miniplay');
      if (m) m.innerHTML = icon(Player.playing ? 'pause' : 'play', 22);
      const t = Player.current;
      const bg = t ? UI.coverSrc(t) : '';
      pb.style.setProperty('--np-art', bg && typeof bg === 'string' ? `url("${bg}")` : 'none');
    };
    Player.on('state', sync);
    Player.on('track', sync);
    sync();
  }

  // 5) Library sheet: header gets an "Add music" button; picking an item closes it
  function wireLibrary() {
    const head = document.querySelector('.lib-header-actions');
    if (head && !document.getElementById('m-import')) {
      const b = document.createElement('button');
      b.id = 'm-import';
      b.className = 'pill-btn';
      b.innerHTML = `${icon('download', 16)}<span>Add music</span>`;
      b.onclick = () => importMenu(b);
      head.prepend(b);
    }
    document.getElementById('lib-list').addEventListener('click', (e) => {
      if (e.target.closest('.lib-item')) setTimeout(() => { body.classList.remove('show-lib'); syncTabs(App.current && App.current.view); }, 30);
    });
  }
  function importMenu(btn) {
    const r = btn.getBoundingClientRect();
    UI.menu([
      { label: 'Choose from Files…', icon: 'folder', action: () => App.importFiles() },
      { label: 'Check for new files', icon: 'refresh', action: async () => { await App.rescanFolders(); UI.toast('Library updated'); } },
      { divider: true },
      { label: 'How to copy music from your PC', icon: 'sparkle', action: helpModal },
    ], r.left, r.bottom + 6);
  }
  function helpModal() {
    UI.modal({
      title: 'Get music onto your iPhone',
      body: `<div class="m-help">
        <p><b>From Aurora on your PC</b> (easiest): plug in your iPhone, open <b>iTunes</b> → the phone icon → <b>File Sharing</b> → <b>Aurora</b>, then drag songs from your Aurora downloads folder into the list.</p>
        <p><b>From the Files app</b>: tap <b>Add music → Choose from Files</b> and pick songs from iCloud Drive, On My iPhone or any other location.</p>
        <p>Anything inside <b>Files → On My iPhone → Aurora</b> is added to your library automatically when Aurora opens.</p>
      </div>`,
      actions: [{ label: 'Got it', primary: true }],
    });
  }

  // 6) refresh when you come back to the app (picks up files copied with iTunes)
  function wireResume() {
    let last = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 5000) App.rescanFolders();
      if (document.visibilityState === 'hidden') last = Date.now();
    });
  }

  function setup() {
    // the Library is always full width on a phone
    const app = document.getElementById('app');
    const unCollapse = () => app.classList.contains('lib-collapsed') && app.classList.remove('lib-collapsed');
    new MutationObserver(unCollapse).observe(app, { attributes: true, attributeFilter: ['class'] });
    unCollapse();
    renderTabs();
    wirePlayer();
    wireLibrary();
    wireResume();
    State.on('profile', renderTabs);
    State.on('profiles', renderTabs);
    // close the full-screen player / library when a modal or menu opens from them
    document.getElementById('overlay-root').addEventListener('click', () => {}, true);
  }
})();
