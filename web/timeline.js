/* timeline.js: D3 swimlane (Danielle)
 * One lane per student. Coloured bars = stays (green outdoor, blue indoor).
 * Red/amber outlines = flags (needs optional flag.start / flag.end in data.json).
 * Draggable scrubber is bound to state.currentTime.
 */
(function () {
  const M = { top: 34, right: 24, bottom: 8, left: 150 };
  const LANE = 28;
  let svg, x, showAll = false, el, data, drawn = false;

  const sevColor = { high: 'var(--alert)', med: 'var(--warn)', low: 'var(--low)' };

  function lanes() {
    const list = data.students.slice().sort((a, b) => b.score - a.score);
    return showAll ? list : list.filter(s => s.flagged);
  }

  function draw() {
    const rows = lanes();
    const W = Math.max(900, el.querySelector('.chart-wrap').clientWidth - 24);
    const H = M.top + rows.length * LANE + M.bottom;
    const wrap = el.querySelector('.chart-wrap');
    wrap.innerHTML = '';

    svg = d3.select(wrap).append('svg').attr('width', W).attr('height', H);
    x = d3.scaleLinear().domain([0, 1440]).range([M.left, W - M.right]);

    // night shading (00:00-06:00 and 21:00-24:00)
    [[0, 360], [1260, 1440]].forEach(([a, b]) =>
      svg.append('rect').attr('x', x(a)).attr('y', M.top).attr('width', x(b) - x(a))
        .attr('height', rows.length * LANE).attr('fill', 'var(--night)'));

    // axis
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${M.top - 6})`)
      .call(d3.axisTop(x).tickValues(d3.range(0, 1441, 180)).tickFormat(App.fmt).tickSize(-6));

    // lanes
    const g = svg.append('g');
    rows.forEach((s, i) => {
      const y = M.top + i * LANE;
      const lane = g.append('g').attr('transform', `translate(0,${y})`);

      lane.append('rect').attr('class', 'lane-bg' + (s.flagged ? ' flagged' : ''))
        .attr('x', M.left).attr('width', x(1440) - M.left).attr('height', LANE - 3).attr('rx', 4)
        .attr('opacity', .55);

      lane.append('text')
        .attr('class', 'lane-label' + (App.state.selectedStudent === s.id ? ' selected' : ''))
        .attr('x', M.left - 10).attr('y', LANE / 2 + 1).attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .text(s.name + (s.flagged ? ` (${s.score.toFixed(1)})` : ''))
        .on('click', () => App.selectStudent(s.id));

      // stays
      s.stays.forEach(st => {
        const pl = App.placeById[st.place] || { name: st.place };
        // a stay past midnight (end > 1440) draws as an evening bar plus an early-morning bar
        const parts = st.end > 1440 ? [[st.start, 1440], [0, st.end - 1440]] : [[st.start, st.end]];
        parts.forEach(([a, b]) => lane.append('rect')
          .attr('x', x(a)).attr('y', 4)
          .attr('width', Math.max(3, x(b) - x(a))).attr('height', LANE - 11).attr('rx', 3)
          .attr('fill', pl.isOutdoor ? 'var(--outdoor)' : 'var(--indoor)').attr('opacity', .9)
          .append('title').text(`${pl.name}: ${App.fmt(st.start)} to ${App.fmt(st.end)}`));
      });

      // flags (outline + marker)
      let lastLabel = -Infinity;
      s.flags.filter(f => f.start != null).sort((a, b) => a.start - b.start).forEach(f => {
        const w = Math.max(6, x(f.end) - x(f.start));
        const c = sevColor[f.severity] || sevColor.low;
        const r = lane.append('rect')
          .attr('x', x(f.start) - 1).attr('y', 1).attr('width', w + 2).attr('height', LANE - 5).attr('rx', 4)
          .attr('fill', 'none').attr('stroke', c).attr('stroke-width', 2);
        r.append('title').text(`${f.rule} (${f.severity}): ${f.detail}`);
        if (x(f.start) - lastLabel < 60) return;   // skip a label that would print over the previous one
        lastLabel = x(f.start);
        lane.append('text').attr('x', x(f.start) + 2).attr('y', -1).attr('fill', c).attr('font-size', 9)
          .attr('font-weight', 700).text(f.rule).style('pointer-events', 'none');
      });
    });

    // scrubber
    const sc = svg.append('g').attr('class', 'scrubber');
    sc.append('line').attr('y1', M.top - 4).attr('y2', H);
    sc.append('rect').attr('class', 'handle').attr('width', 46).attr('height', 18).attr('rx', 9).attr('x', -23).attr('y', 2);
    sc.append('text').attr('text-anchor', 'middle').attr('y', 15);

    const drag = d3.drag().on('drag', ev => {
      const t = Math.max(0, Math.min(1439, Math.round(x.invert(ev.x))));
      App.setState({ currentTime: t });
    });
    sc.call(drag);
    svg.on('click', ev => {
      const px = d3.pointer(ev)[0];
      if (px >= M.left) App.setState({ currentTime: Math.round(Math.max(0, Math.min(1439, x.invert(px)))) });
    });
    drawn = true;
    moveScrubber();
  }

  function moveScrubber() {
    if (!drawn || App.state.currentTime == null) return;
    const px = x(App.state.currentTime);
    svg.select('.scrubber').attr('transform', `translate(${px},0)`)
      .select('text').text(App.fmt(App.state.currentTime));
  }

  window.Views = window.Views || {};
  window.Views.timeline = {
    mount(container, d) {
      el = container; data = d; drawn = false;
      el.innerHTML = `
        <div class="toolbar">
          <h2 style="margin:0">Timeline</h2>
          <label><input type="checkbox" id="all"> Include clean students</label>
          <span class="muted" style="font-size:13px">Drag or click to move the clock. Click a name to open their card.</span>
        </div>
        <div class="chart-wrap"></div>
        <div class="legend">
          <span><i style="background:var(--indoor)"></i>Indoor stay</span>
          <span><i style="background:var(--outdoor)"></i>Outdoor stay</span>
          <span><i style="border:2px solid var(--alert)"></i>High flag</span>
          <span><i style="border:2px solid var(--warn)"></i>Medium flag</span>
          <span><i style="border:2px solid var(--low)"></i>Low flag</span>
          <span><i style="background:var(--night)"></i>Night / closed hours</span>
        </div>`;
      el.querySelector('#all').checked = showAll;
      el.querySelector('#all').onchange = e => { showAll = e.target.checked; draw(); };
      draw();
      window.addEventListener('resize', this._rs = () => draw());
    },
    update(state, patch) {
      if ('selectedStudent' in patch) draw(); else moveScrubber();
    },
    unmount() { window.removeEventListener('resize', this._rs); drawn = false; }
  };
})();
