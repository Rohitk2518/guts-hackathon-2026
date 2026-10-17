/* app.js: shared state + screen router (Danielle)
 *
 * Contract for views (Som's modules follow the same one):
 *   window.Views.<mode> = { mount(el, data), update(state, patch), unmount() }
 *   - mount():  build the screen inside el
 *   - update(): called on every setState while this view is active
 *   - unmount(): optional cleanup
 *
 * Extra hooks:
 *   window.Views.card = { open(studentId) }   -> Som's interrogation card
 *   App.selectStudent(id) sets state and calls Views.card.open if present.
 */
(function () {
  const state = {
    currentTime: null,      // minutes after midnight: drives clock + map
    selectedStudent: null,  // student ID: drives card + highlights
    mode: 'summary',        // 'summary' | 'timeline' | 'network' | 'map' | 'story' | 'evidence'
    storyStep: 0,           // index into findings[]
    revealMode: false       // true = show kingpin links + fade clean students
  };

  const listeners = [];
  window.Views = window.Views || {};

  const TABS = [
    { mode: 'summary',  label: 'Case' },
    { mode: 'story',    label: 'Story' },
    { mode: 'map',      label: 'Map' },
    { mode: 'timeline', label: 'Timeline' },
    { mode: 'network',  label: 'Network' }
  ];

  const App = {
    state,
    data: null,
    byId: {},
    placeById: {},
    current: null,

    /* minutes -> "HH:MM" */
    fmt(min) {
      if (min == null) return '--:--';
      const m = ((Math.round(min) % 1440) + 1440) % 1440;
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    },
    isNight(min) { return min < 360 || min >= 1260; },

    subscribe(fn) { listeners.push(fn); },

    setState(patch) {
      const modeChanged = patch.mode && patch.mode !== state.mode;
      Object.assign(state, patch);
      if (modeChanged) App.route();
      listeners.forEach(fn => fn(state, patch));
      if (!modeChanged && App.current && App.current.update) App.current.update(state, patch);
      App.renderChrome();
    },

    selectStudent(id) {
      App.setState({ selectedStudent: id });
      if (Views.card && Views.card.open && id) Views.card.open(id);
    },

    renderChrome() {
      document.getElementById('clock-time').textContent = App.fmt(state.currentTime);
      document.getElementById('clock-icon').textContent =
        state.currentTime != null && App.isNight(state.currentTime) ? 'Night' : 'Day';
      document.querySelectorAll('.tab').forEach(t =>
        t.classList.toggle('active', t.dataset.mode === state.mode));
    },

    route() {
      const el = document.getElementById('view');
      if (App.current && App.current.unmount) App.current.unmount();
      el.innerHTML = '';
      const view = Views[state.mode];
      App.current = view || null;
      if (view) {
        view.mount(el, App.data);
        if (view.update) view.update(state, {});
      } else {
        el.innerHTML = '<div class="placeholder"><h2>' + state.mode +
          '</h2><p>This screen is built by Som. It will appear when <code>' +
          state.mode + '.js</code> registers <code>Views.' + state.mode + '</code>.</p></div>';
      }
    },

    // dark/light toggle; the icon shows the mode you will switch to
    initTheme() {
      const btn = document.getElementById('theme-btn'), root = document.documentElement;
      const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
      const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
      const paint = () => {
        const dark = root.dataset.theme !== 'light';
        btn.innerHTML = dark ? SUN : MOON;
        btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      };
      btn.onclick = () => {
        root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
        try { localStorage.setItem('theme', root.dataset.theme); } catch (e) { /* private window: theme just won't persist */ }
        paint();
      };
      paint();
    },

    async boot() {
      App.initTheme();
      try {
        const res = await fetch('data.json');
        App.data = await res.json();
      } catch (e) {
        document.getElementById('view').innerHTML =
          '<div class="placeholder"><h2>Could not load data.json</h2>' +
          '<p>Open via a web server, not file://. Run <code>python -m http.server</code> in <code>web/</code>.</p></div>';
        return;
      }
      // fill fields the pipeline may leave out, so every view can rely on them
      App.data.students.forEach(s => {
        s.flags = s.flags || []; s.stays = s.stays || []; s.claims = s.claims || [];
        s.score = s.score ?? 0;
        if (s.flagged == null) s.flagged = s.flags.length > 0;
        s.isKingpin = s.id === App.data.kingpin;
        App.byId[s.id] = s;
      });
      App.data.buildings.forEach(b => (App.placeById[b.id] = b));
      document.getElementById('mock-badge').hidden = !(App.data.meta && App.data.meta.mock);

      const tabs = document.getElementById('tabs');
      TABS.forEach(t => {
        const b = document.createElement('button');
        b.className = 'tab'; b.dataset.mode = t.mode; b.textContent = t.label;
        b.onclick = () => App.setState({ mode: t.mode });
        tabs.appendChild(b);
      });

      state.currentTime = 480;
      App.route();
      App.renderChrome();
    }
  };

  window.App = App;
})();
