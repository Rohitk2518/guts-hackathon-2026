/* map.js: campus map on a real street basemap (Som)
 * campus.jpg = Esri World Street Map tiles, zoom 17, x 63972-63978, y 40896-40900, stitched once
 * so the demo works offline. Buildings use the same Web Mercator maths so they sit on their outlines.
 * Student dots sit in the building they are logged in at state.currentTime, or walk between two
 * buildings when the gap between stays is short.
 *
 * Views.map.mount(el, data, { controls:false }) lets story.js embed the map.
 * Views.map.focus(placeId | null) zooms; Views.map.highlight(ids | null) fades everyone else.
 */
(function () {
  const Z = 17, X0 = 63972, Y0 = 40896, IMG_W = 1792, IMG_H = 1280;
  const PAD = 110, ZOOM = 2.2;
  const WALK_MAX = 30;   // ponytail: gaps longer than this hide the dot (left campus); tune if real data looks sparse
  // label side per building where the default (below) collides; tune by eye
  const LABEL = { boyd_orr: 'left', sir_alwyn: 'above', adam_smith: 'above', hive: 'above', kelvin: 'right', guu: 'right' };
  const LABEL_AT = { below: [0, 32, 'middle'], above: [0, -36, 'middle'], left: [-20, 5, 'end'], right: [20, 5, 'start'] };

  let svg, data, pos = {}, stays = {}, timer = null, highlightIds = null, base;

  // lat/lng -> pixel on campus.jpg (Web Mercator, same as the tiles)
  function merc(lat, lng) {
    const n = 256 * 2 ** Z, r = lat * Math.PI / 180;
    return [(lng + 180) / 360 * n - X0 * 256, (1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n - Y0 * 256];
  }

  function isOpen(b, t) {
    if (b.isOutdoor || b.opens === b.closes) return true;
    return b.opens < b.closes ? t >= b.opens && t < b.closes : t >= b.opens || t < b.closes; // wraps past midnight
  }

  // where is student s at minute t? also checks t+1440 for stays that run past midnight
  function where(s, t) {
    const st = stays[s.id];
    for (const tt of [t, t + 1440]) {
      for (let i = 0; i < st.length; i++) {
        if (tt >= st[i].start && tt < st[i].end) return { place: st[i].place };
        const n = st[i + 1];
        if (n && tt >= st[i].end && tt < n.start && n.start - st[i].end <= WALK_MAX)
          return { from: st[i].place, to: n.place, f: (tt - st[i].end) / (n.start - st[i].end) };
      }
    }
    return null;
  }

  function hours(b) {
    if (b.isOutdoor || b.opens === b.closes) return 'Open all day';
    return App.fmt(b.opens) + ' to ' + App.fmt(b.closes);
  }

  function draw(el) {
    data.buildings.forEach(b => (pos[b.id] = merc(b.lat, b.lng)));
    const xs = Object.values(pos).map(p => p[0]), ys = Object.values(pos).map(p => p[1]);
    const x0 = Math.max(0, d3.min(xs) - PAD), y0 = Math.max(0, d3.min(ys) - PAD);
    base = [x0, y0, Math.min(IMG_W, d3.max(xs) + PAD) - x0, Math.min(IMG_H, d3.max(ys) + PAD) - y0];

    svg = d3.select(el).append('svg').attr('class', 'campus').attr('viewBox', base.join(' '))
      .style('aspect-ratio', `${base[2]} / ${base[3]}`)
      .attr('role', 'img').attr('aria-label', 'Campus map of student locations');
    svg.append('image').attr('class', 'basemap').attr('href', 'campus.jpg').attr('width', IMG_W).attr('height', IMG_H);
    svg.append('rect').attr('class', 'map-shade').attr('width', IMG_W).attr('height', IMG_H);

    // 200 m scale bar: lets viewers judge walking distances (5 km/h is about 80 m a minute)
    const perMetre = 256 * 2 ** Z / (40075016.686 * Math.cos(d3.mean(data.buildings, b => b.lat) * Math.PI / 180));
    const len = 200 * perMetre;
    const sb = svg.append('g').attr('class', 'scale').attr('transform', `translate(${base[0] + 36},${base[1] + base[3] - 30})`);
    sb.append('path').attr('d', `M0,-6V0H${len}V-6`);
    sb.append('text').attr('x', len + 10).text('200 m, about 2.5 min walk');

    const bg = svg.append('g').selectAll('g').data(data.buildings).join('g')
      .attr('class', b => 'bld' + (b.isOutdoor ? ' outdoor' : ''))
      .attr('transform', b => `translate(${pos[b.id]})`);
    bg.append('rect').attr('x', -11).attr('y', -11).attr('width', 22).attr('height', 22).attr('rx', 4);
    const lbl = bg.append('g').each(function (b) {
      const [x, y, anchor] = LABEL_AT[LABEL[b.id] || 'below'];
      d3.select(this).attr('transform', `translate(${x},${y})`).attr('text-anchor', anchor);
    });
    lbl.append('text').attr('class', 'bld-name').text(b => b.name);
    lbl.append('text').attr('class', 'bld-hours').attr('y', 17).text(hours);
    bg.append('title').text(b => b.name + ': ' + hours(b));

    svg.append('g').attr('class', 'markers').selectAll('g').data(data.students, s => s.id).join('g')
      .attr('class', 'mk').attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', s => 'Open card for ' + s.name)
      .on('click', (ev, s) => App.selectStudent(s.id))
      .on('keydown', (ev, s) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); App.selectStudent(s.id); } })
      .each(function (s) {
        const g = d3.select(this);
        if (s.flagged) g.append('circle').attr('class', 'ring pulse').attr('r', 10);
        g.append('circle').attr('class', 'dot').attr('r', s.flagged ? 10 : 7);
        g.append('title').text(s.name + (s.flagged ? ', score ' + s.score.toFixed(1) : ''));
      });
  }

  function render(state) {
    if (!svg) return;
    const t = state.currentTime ?? 480;
    svg.classed('night', App.isNight(t)).classed('reveal', state.revealMode);
    svg.selectAll('.bld').classed('closed', b => !isOpen(b, t));

    const slot = {};   // spread students sharing a building around its centre
    let here = 0;
    svg.selectAll('.mk').each(function (s) {
      const w = where(s, t), g = d3.select(this);
      if (!w) return g.attr('display', 'none');
      here++;
      let x, y;
      if (w.place) {
        const i = slot[w.place] = (slot[w.place] ?? -1) + 1;
        const a = i * 2.4, r = 20 + 6 * Math.sqrt(i);
        [x, y] = pos[w.place] || [0, 0];
        x += r * Math.cos(a); y += r * Math.sin(a);
      } else {
        const [ax, ay] = pos[w.from] || [0, 0], [bx, by] = pos[w.to] || [0, 0];
        x = ax + (bx - ax) * w.f; y = ay + (by - ay) * w.f;
      }
      g.attr('display', null).attr('transform', `translate(${x},${y})`)
        .attr('class', 'mk' + (s.flagged ? ' flagged' : ' clean') + (s.isKingpin ? ' kingpin' : '') +
          (state.selectedStudent === s.id ? ' selected' : '') +
          ((highlightIds && !highlightIds.includes(s.id)) || (state.revealMode && !s.flagged && !s.isKingpin) ? ' dim' : ''));
    });
    const count = document.getElementById('map-count');
    if (count) count.textContent = `${here} of ${data.students.length} students on campus`;
    const now = document.getElementById('map-now');
    if (now) now.textContent = App.fmt(t);
  }

  function stop(btn) { clearInterval(timer); timer = null; if (btn) btn.textContent = 'Play the day'; }

  window.Views = window.Views || {};
  window.Views.map = {
    mount(el, d, opts = {}) {
      data = d; pos = {}; highlightIds = null;
      data.students.forEach(s => (stays[s.id] = s.stays.slice().sort((a, b) => a.start - b.start)));
      const controls = opts.controls !== false;
      el.innerHTML = '<div class="map-stage">' + (controls ? `
        <div class="toolbar">
          <h2 style="margin:0">Campus map</h2>
          <span class="muted" id="map-count"></span>
        </div>` : '') + `
        <div class="map-wrap"><div class="map-credit">Basemap: Esri, HERE, Garmin, &copy; OpenStreetMap contributors</div></div>` +
        (controls ? `
        <div class="map-bar">
          <button class="btn" id="map-play">Play the day</button>
          <input type="range" id="map-time" class="map-time" min="0" max="1439" step="1" aria-label="Time of day">
          <span class="map-now" id="map-now"></span>
        </div>` : '') + `
        <div class="legend">
          <span><i style="background:var(--alert)"></i>Flagged student</span>
          <span><i style="background:var(--clean)"></i>Other student</span>
          <span><i style="background:var(--gold)"></i>Mastermind, after the reveal</span>
          <span><i style="background:var(--indoor);border-radius:2px"></i>Building open</span>
          <span><i style="border:1px dashed var(--clean);border-radius:2px"></i>Building closed</span>
        </div></div>`;
      draw(el.querySelector('.map-wrap'));
      // fit the whole map plus controls on one screen
      el.querySelector('.map-stage').style.maxWidth = `calc((100vh - ${controls ? 270 : 200}px) * ${base[2] / base[3]})`;

      const range = el.querySelector('#map-time'), btn = el.querySelector('#map-play');
      if (range) {
        range.oninput = () => App.setState({ currentTime: +range.value });
        btn.onclick = () => {
          if (timer) return stop(btn);
          btn.textContent = 'Pause';
          timer = setInterval(() => {
            const t = (App.state.currentTime ?? 0) + 2;
            if (t > 1439) return stop(btn);
            App.setState({ currentTime: t });
          }, 40);
        };
      }
      this._range = range;
    },
    update(state) {
      if (this._range) this._range.value = state.currentTime ?? 480;
      render(state);
    },
    unmount() { stop(); svg = null; },

    focus(placeId) {
      if (!svg) return;
      const p = placeId && pos[placeId], w = base[2] / ZOOM, h = base[3] / ZOOM;
      const vb = p ? [p[0] - w / 2, p[1] - h / 2, w, h] : base;
      svg.transition().duration(900).attr('viewBox', vb.join(' '));
    },
    highlight(ids) { highlightIds = ids; render(App.state); },

    _test: { isOpen, where, merc }
  };

  // self-check: open hours that wrap past midnight, walking between stays, projection lands on the image
  const T = window.Views.map._test, lib = { opens: 420, closes: 120 };
  console.assert(T.isOpen(lib, 60) && T.isOpen(lib, 1400) && !T.isOpen(lib, 300), 'isOpen wrap');
  console.assert(T.isOpen({ opens: 0, closes: 0 }, 300), 'isOpen 0000-0000');
  stays.t = [{ place: 'a', start: 100, end: 200 }, { place: 'b', start: 220, end: 300 }];
  console.assert(T.where({ id: 't' }, 150).place === 'a' && T.where({ id: 't' }, 210).f === .5 && !T.where({ id: 't' }, 400), 'where');
  delete stays.t;
  const [bx, by] = T.merc(55.8735737, -4.2926741);   // Boyd Orr
  console.assert(bx > 0 && bx < IMG_W && by > 0 && by < IMG_H, 'merc on image');
})();
