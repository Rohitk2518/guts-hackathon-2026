/* timeline.js: D3 swimlane (Danielle)
 * One lane per student. Coloured bars = stays (green confirmed, blue claimed).
 * Red/amber outlines = flags (needs optional flag.start / flag.end in data.json).
 * Draggable scrubber is bound to state.currentTime.
 */
(function () {
  const AVATAR = 30;                       // avatar size in px (passed to App.avatar)
  const M = { top: 34, right: 24, bottom: 8, left: 200 };   // left column holds avatar + name
  const LANE = AVATAR + 4;
  const LANE_MAX = 1640;
  let svg, x, showAll = false, showStays = true, showClaims = true, el, data, drawn = false;

  const sevColor = { high: 'var(--alert)', med: 'var(--warn)', low: 'var(--low)' };

  /* ---- flag popover: an HTML div, fixed-positioned so the chart's scroll area can't clip it ---- */
  let pop = null;
  function closePop() {
    if (pop) { pop.remove(); pop = null; }
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onKey(e) { if (e.key === 'Escape') closePop(); }
  function onOutside(e) { if (pop && !pop.contains(e.target)) closePop(); }

  function showPop(anchor, s, f) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'flag-pop';
    // positioning set inline so it works even if style.css is stale or cached
    pop.style.position = 'fixed';
    pop.style.zIndex = '1000';
    pop.style.left = '0px';
    pop.style.top = '0px';
    const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    pop.innerHTML = `
      <button class="flag-pop-close" aria-label="Close">×</button>
      <div class="flag-pop-head"><span class="chip ${f.severity === 'high' ? '' : f.severity}">${esc(f.rule)}</span>
        <strong>${esc(s.name)}</strong></div>
      <div class="mono muted">${App.fmt(f.start)} to ${App.fmt(f.end)} · ${esc(f.severity)} severity</div>
      <p>${esc(f.detail)}</p>
      <button class="btn secondary flag-pop-open">Open interrogation card</button>`;
    document.body.appendChild(pop);

    // position below the flag box, flipped/clamped to stay on screen
    const a = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(Math.max(8, a.left), window.innerWidth - pw - 8);
    let top = a.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, a.top - ph - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    pop.querySelector('.flag-pop-close').onclick = closePop;
    pop.querySelector('.flag-pop-open').onclick = () => { closePop(); App.selectStudent(s.id); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside, true);
  }

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
    x = d3.scaleLinear().domain([0, LANE_MAX]).range([M.left, W - M.right]);

    // night shading (00:00-06:00 and 21:00-24:00)
    [[0, 360], [1260, LANE_MAX]].forEach(([a, b]) =>
      svg.append('rect').attr('x', x(a)).attr('y', M.top).attr('width', x(b) - x(a))
        .attr('height', rows.length * LANE).attr('fill', 'var(--night)').attr('opacity', .7));

    // axis
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${M.top - 6})`)
      .call(d3.axisTop(x).tickValues(d3.range(0, LANE_MAX + 1, 180)).tickFormat(App.fmt).tickSize(-6));

    // lanes
    const g = svg.append('g');
    rows.forEach((s, i) => {
      const y = M.top + i * LANE;
      const lane = g.append('g').attr('transform', `translate(0,${y})`);

      lane.append('rect').attr('class', 'lane-bg' + (s.flagged ? ' flagged' : ''))
        .attr('x', M.left).attr('width', x(LANE_MAX) - M.left).attr('height', LANE - 3).attr('rx', 4)
        .attr('opacity', .55);

      // student photo to the left of the name (HTML from App.avatar, hosted in a foreignObject)
      if (typeof App.avatar === 'function') {
        lane.append('foreignObject')
          .attr('x', 6).attr('y', (LANE - 3 - AVATAR) / 2).attr('width', AVATAR).attr('height', AVATAR)
          .style('cursor', 'pointer')
          .on('click', () => App.selectStudent(s.id))
          .append('xhtml:div')
          .style('width', AVATAR + 'px').style('height', AVATAR + 'px').style('line-height', 0)
          .html(`${App.avatar(s, AVATAR)}`);
      }

      lane.append('text')
        .attr('class', 'lane-label' + (App.state.selectedStudent === s.id ? ' selected' : ''))
        .attr('x', typeof App.avatar === 'function' ? AVATAR + 16 : 10)
        .attr('y', LANE / 2 - 1).attr('text-anchor', 'start').attr('dominant-baseline', 'middle')
        .text(s.name + (s.flagged ? ` · ${s.score.toFixed(1)}` : ''))
        .on('click', () => App.selectStudent(s.id));

      // stays
      (showStays ? s.stays : []).forEach(st => {
        const pl = App.placeById[st.place] || { name: st.place };
        lane.append('rect')
          .attr('x', x(st.start)).attr('y', 4)
          .attr('width', Math.max(3, x(st.end) - x(st.start))).attr('height', LANE - 24).attr('rx', 3)
          .attr('fill', 'var(--stay)')
          .append('title').text(`${pl.name}: ${App.fmt(st.start)} to ${App.fmt(st.end)}`);
      });

      // claims
      (showClaims ? s.claims : []).forEach(c => {
        const cp = App.placeById[c.place] || {name: c.place};
        lane.append('rect')
          .attr('x', x(c.start)).attr('y', 15)
          .attr('width', Math.max(3, x(c.end) - x(c.start))).attr('height', LANE - 24).attr('rx', 3)
          .attr('fill', 'var(--claim)').attr('opacity', .6)
          .append('title').text(`${cp.name}: ${App.fmt(c.start)} to ${App.fmt(c.end)}`);
      });

      // flags (outline + marker)
      s.flags.filter(f => f.start != null).forEach(f => {
        const w = Math.max(6, x(f.end) - x(f.start));
        const c = sevColor[f.severity] || sevColor.low;

        const r = lane.append('rect')
          .attr('x', x(f.start) - 1).attr('y', 1).attr('width', w + 2).attr('height', LANE - 5).attr('rx', 4)
          .attr('fill', 'var(--night)').attr('fill-opacity', 0)
          .attr('stroke', c).attr('stroke-width', 2)
          .style('pointer-events', 'all')
          .style('cursor', 'pointer')
          .on('mouseenter', function () {
            label.transition().duration(120).attr('opacity', 1);
            d3.select(this).transition().duration(120).attr('fill-opacity', 0.65);
          })
          .on('mouseleave', function () {
            label.transition().duration(120).attr('opacity', 0);
            d3.select(this).transition().duration(120).attr('fill-opacity', 0);
          })
          .on('click', ev => { ev.stopPropagation(); showPop(ev.currentTarget, s, f); });
                // label is hidden until the flag box is hovered
        const label = lane.append('text').attr('x', x(f.start) + 4).attr('y', 20).attr('fill', c).attr('font-size', 12)
          .attr('font-weight', 700).text(f.rule).attr('opacity', 0).style('pointer-events', 'none');

        r.append('title').text(`${f.rule} (${f.severity}): ${f.detail}`);
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
      closePop();
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
          <label><input type="checkbox" id="show-stays"> Show stays (logs)</label>
          <label><input type="checkbox" id="show-claims"> Show claims (testimony)</label>
          <div>
            <span class="muted" style="font-size:13px">Drag or click to move the clock. Click a name to open their card.</span>
          </div>
          <div class="legend">
            <span><i style="background:var(--stay)"></i>Logged stay</span>
            <span><i style="background:var(--claim)"></i>Claimed stay</span>
            <span><i style="border:2px solid var(--alert)"></i>High flag</span>
            <span><i style="border:2px solid var(--warn)"></i>Medium flag</span>
            <span><i style="border:2px solid var(--low)"></i>Low flag</span>
            <span><i style="background:var(--night)"></i>Night / closed hours</span>
          </div>
          </div>
        <div class="chart-wrap"></div>
        `;
      el.querySelector('#all').checked = showAll;
      el.querySelector('#all').onchange = e => { showAll = e.target.checked; draw(); };
      el.querySelector('#show-stays').checked = showStays;
      el.querySelector('#show-stays').onchange = e => { showStays = e.target.checked; draw(); };
      el.querySelector('#show-claims').checked = showClaims;
      el.querySelector('#show-claims').onchange = e => { showClaims = e.target.checked; draw(); };
      draw();
      window.addEventListener('resize', this._rs = () => draw());
    },
    update(state, patch) {
      if ('selectedStudent' in patch) draw(); else moveScrubber();
    },
    unmount() { closePop(); window.removeEventListener('resize', this._rs); drawn = false; }
  };
})();