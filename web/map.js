/* map.js: SVG campus map (Som)
 * Buildings are placed from real lat/lng. Student dots sit in the building
 * they are logged in at state.currentTime, or walk between two buildings
 * when the gap between stays is short.
 *
 * Views.map.mount(el, data, { controls:false }) lets story.js embed the map.
 * Views.map.focus(placeId | null) zooms; Views.map.highlight(ids | null) fades everyone else.
 */
(function () {
  const W = 1000, H = 620, PAD = 70;
  const WALK_MAX = 30;   // ponytail: gaps longer than this hide the dot (left campus); tune if real data looks sparse
  const ZOOM = 2.4;
  // label side per building where the default (below) collides; tune by eye
  const LABEL = { boyd_orr: 'left', sir_alwyn: 'above', adam_smith: 'above', hive: 'above', kelvin: 'right' };
  const LABEL_AT = { below: [0, 22, 'middle'], above: [0, -26, 'middle'], left: [-14, 2, 'end'], right: [14, 2, 'start'] };

  let svg, data, pos = {}, stays = {}, timer = null, highlightIds = null;

  function isOpen(b, t) {
    if (b.isOutdoor || b.opens === b.closes) return true;
    return b.opens < b.closes ? t >= b.opens && t < b.closes : t >= b.opens || t < b.closes; // wraps past midnight
  }

  // project lat/lng to the viewBox, same scale on both axes
  function project(bs) {
    const k = Math.cos(d3.mean(bs, b => b.lat) * Math.PI / 180);
    const px = bs.map(b => b.lng * k), py = bs.map(b => -b.lat);
    const [x0, x1] = d3.extent(px), [y0, y1] = d3.extent(py);
    const s = Math.min((W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (y1 - y0));
    const ox = (W - s * (x1 - x0)) / 2, oy = (H - s * (y1 - y0)) / 2;
    bs.forEach((b, i) => (pos[b.id] = [ox + (px[i] - x0) * s, oy + (py[i] - y0) * s]));
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
    project(data.buildings);
    svg = d3.select(el).append('svg').attr('class', 'campus').attr('viewBox', `0 0 ${W} ${H}`);
    svg.append('rect').attr('class', 'map-ground').attr('x', -W).attr('y', -H).attr('width', 3 * W).attr('height', 3 * H);

    const outdoor = data.buildings.filter(b => b.isOutdoor);
    svg.append('g').selectAll('circle').data(outdoor).join('circle')
      .attr('class', 'park').attr('r', 58).attr('cx', b => pos[b.id][0]).attr('cy', b => pos[b.id][1]);

    const bg = svg.append('g').selectAll('g').data(data.buildings).join('g')
      .attr('class', b => 'bld' + (b.isOutdoor ? ' outdoor' : ''))
      .attr('transform', b => `translate(${pos[b.id]})`);
    bg.append('rect').attr('x', -8).attr('y', -8).attr('width', 16).attr('height', 16).attr('rx', 3);
    const lbl = bg.append('g').each(function (b) {
      const [x, y, anchor] = LABEL_AT[LABEL[b.id] || 'below'];
      d3.select(this).attr('transform', `translate(${x},${y})`).attr('text-anchor', anchor);
    });
    lbl.append('text').attr('class', 'bld-name').text(b => b.name);
    lbl.append('text').attr('class', 'bld-hours').attr('y', 12).text(hours);
    bg.append('title').text(b => b.name + ': ' + hours(b));

    svg.append('g').attr('class', 'markers').selectAll('g').data(data.students, s => s.id).join('g')
      .attr('class', 'mk')
      .each(function (s) {
        const g = d3.select(this);
        if (s.flagged) g.append('circle').attr('class', 'ring pulse').attr('r', 7);
        g.append('circle').attr('class', 'dot').attr('r', s.flagged ? 7 : 4.5);
        g.append('title').text(s.name + (s.flagged ? ' (score ' + s.score.toFixed(1) + ')' : ''));
      })
      .on('click', (ev, s) => App.selectStudent(s.id));
  }

  function render(state) {
    if (!svg) return;
    const t = state.currentTime ?? 480;
    svg.classed('night', App.isNight(t)).classed('reveal', state.revealMode);
    svg.selectAll('.bld').classed('closed', b => !isOpen(b, t));

    const slot = {};   // spread students sharing a building around its centre
    svg.selectAll('.mk').each(function (s) {
      const w = where(s, t), g = d3.select(this);
      if (!w) return g.attr('display', 'none');
      let x, y;
      if (w.place) {
        const i = slot[w.place] = (slot[w.place] ?? -1) + 1;
        const a = i * 2.4, r = 12 + 4 * Math.sqrt(i);
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
  }

  function stop(btn) { clearInterval(timer); timer = null; if (btn) btn.textContent = 'Play day'; }

  window.Views = window.Views || {};
  window.Views.map = {
    mount(el, d, opts = {}) {
      data = d; pos = {}; highlightIds = null;
      data.students.forEach(s => (stays[s.id] = s.stays.slice().sort((a, b) => a.start - b.start)));
      el.innerHTML = (opts.controls === false ? '' : `
        <div class="toolbar">
          <h2 style="margin:0">Campus map</h2>
          <button class="btn secondary" id="map-play">Play day</button>
          <input type="range" id="map-time" class="map-time" min="0" max="1439" step="1" aria-label="Time of day">
          <span class="muted" style="font-size:13px">Click a dot to open their card.</span>
        </div>`) + `
        <div class="map-wrap"></div>
        <div class="legend">
          <span><i style="background:var(--alert)"></i>Flagged student</span>
          <span><i style="background:var(--clean)"></i>Other student</span>
          <span><i style="background:var(--indoor)"></i>Building open</span>
          <span><i style="border:1px dashed var(--muted)"></i>Building closed</span>
        </div>`;
      draw(el.querySelector('.map-wrap'));

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
      const p = placeId && pos[placeId];
      const vb = p ? [p[0] - W / ZOOM / 2, p[1] - H / ZOOM / 2, W / ZOOM, H / ZOOM] : [0, 0, W, H];
      svg.transition().duration(900).attr('viewBox', vb.join(' '));
    },
    highlight(ids) { highlightIds = ids; render(App.state); },

    _test: { isOpen, where }
  };

  // self-check: open hours that wrap past midnight, and walking between stays
  const T = window.Views.map._test, lib = { opens: 420, closes: 120 };
  console.assert(T.isOpen(lib, 60) && T.isOpen(lib, 1400) && !T.isOpen(lib, 300), 'isOpen wrap');
  console.assert(T.isOpen({ opens: 0, closes: 0 }, 300), 'isOpen 0000-0000');
  stays.t = [{ place: 'a', start: 100, end: 200 }, { place: 'b', start: 220, end: 300 }];
  console.assert(T.where({ id: 't' }, 150).place === 'a' && T.where({ id: 't' }, 210).f === .5 && !T.where({ id: 't' }, 400), 'where');
  delete stays.t;
})();
