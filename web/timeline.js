/* timeline.js: D3 swimlane (Danielle)
 * One lane per student. Coloured bars = stays (green confirmed, blue claimed).
 * Red/amber outlines = flags (needs optional flag.start / flag.end in data.json).
 * Draggable scrubber is bound to state.currentTime.
 *
 * Click a lane to expand it: stays, claims and flags each get their own line, with the text of each
 * bar's title under it. Items with no time recorded can't be drawn on the axis, so they are listed as
 * plain text lines in the same section. Click the lane again to collapse it.
 */
(function () {
  const AVATAR = 30;                       // avatar size in px (passed to App.avatar)
  const M = { top: 34, right: 24, bottom: 8, left: 200 };   // left column holds avatar + name
  const LANE = AVATAR + 4;
  const LANE_MAX = 1640;
  // expanded-lane layout
  const FONT = 10;        // size of the text under each bar
  const SUB = 13;         // height of one line of text
  const BAR_H = 10;       // stay / claim bar height
  const FLAG_H = 16;      // flag box height
  const SEC_GAP = 8;      // space between the stays / claims / flags sections
  let svg, x, showAll = false, showStays = true, showClaims = true, el, data, drawn = false;
  const expanded = new Set();             // student ids whose lane is open (kept across redraws)

  const sevColor = { high: 'var(--alert)', med: 'var(--warn)', low: 'var(--low)' };

  /* ---- text helpers ---- */
  const tm = m => (m == null ? '?' : App.fmt(m));
  // real data uses names like 'main building' for stays and 'QMU' / 'home' for claims, so fall back gracefully
  function placeLabel(p) {
    if (p == null) return 'unknown place';
    const direct = App.placeById[p];
    if (direct) return direct.name;
    const key = String(p).toLowerCase().replace(/_/g, ' ').trim();
    const b = data.buildings.find(b => b.name.toLowerCase() === key || b.id.replace(/_/g, ' ') === key);
    return b ? b.name : String(p);
  }
  function spanText(p, a, b) {
    return a == null && b == null ? `${placeLabel(p)}: no time given` : `${placeLabel(p)}: ${tm(a)} to ${tm(b)}`;
  }

  let _ctx = null;
  function textW(t) {
    try {
      _ctx = _ctx || document.createElement('canvas').getContext('2d');
      _ctx.font = `${FONT}px Inter, "Segoe UI", system-ui, sans-serif`;
      return _ctx.measureText(t).width;
    } catch (e) { return String(t).length * FONT * 0.56; }
  }
  function fitText(t, maxW) {
    if (textW(t) <= maxW) return t;
    let s = t;
    while (s.length > 1 && textW(s + '…') > maxW) s = s.slice(0, -1);
    return s + '…';
  }

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

  /* ---- expanded-lane layout ---- */
  // put each label on the first line where it doesn't collide with the previous label; returns the line count
  function packRows(items) {
    const ends = [];
    items.sort((a, b) => a.tx - b.tx).forEach(it => {
      let r = ends.findIndex(e => e + 15 <= it.tx);
      if (r < 0) { r = ends.length; ends.push(0); }
      it.row = r; ends[r] = it.tx + it.tw;
    });
    return ends.length;
  }

  // work out the height of a student's lane and where everything inside it goes
  function layoutFor(s, W) {
    if (!expanded.has(s.id)) return { h: LANE, open: false };

    const maxText = W - M.right - M.left - 8;
    // drawable: has a start time. everything else becomes a plain text line.
    const split = (arr, textFn) => {
      const items = [], lines = [];
      arr.forEach(src => {
        const text = textFn(src);
        if (src.start == null) { lines.push({ src, text }); return; }
        const x0 = x(src.start), x1 = src.end != null ? x(src.end) : x0;
        const tw = textW(text);
        items.push({ src, text, tw, x0, w: Math.max(3, x1 - x0),
          tx: Math.max(M.left + 4, Math.min(x0, W - M.right - tw)) });   // keep the label inside the chart
      });
      return { items, lines };
    };

    const sections = [];
    let y = LANE + 2;
    const add = (key, label, arr, textFn, barH, colour) => {
      const { items, lines } = split(arr, textFn);
      if (!items.length && !lines.length) return;
      const rows = items.length ? packRows(items) : 0;
      const sec = { key, label, items, lines, rows, barH, colour, y };
      let cur = y;
      if (items.length) cur += barH + 4 + rows * SUB;
      sec.linesY = cur + (items.length ? 2 : 0);
      cur = sec.linesY + lines.length * SUB;
      sec.end = cur;
      y = cur + SEC_GAP;
      sections.push(sec);
    };
    if (showStays) add('stays', 'Stays', s.stays, st => spanText(st.place, st.start, st.end), BAR_H, 'var(--stay)');
    if (showClaims) add('claims', 'Claims', s.claims, c => spanText(c.place, c.start, c.end), BAR_H, 'var(--claim)');
    add('flags', 'Flags', s.flags,
      f => (f.start != null ? `${f.rule} (${f.severity})` : `${f.rule} (${f.severity}): ${f.detail}`), FLAG_H, null);

    const noTime = [s.stays, s.claims, s.flags].reduce((n, arr) => n + arr.filter(i => i.start == null).length, 0);
    const summary = `${s.stays.length} stays · ${s.claims.length} claims · ${s.flags.length} flags` +
      (noTime ? ` · ${noTime} without a time (listed as text)` : '');
    return { h: Math.max(LANE, y), open: true, sections, summary, maxText };
  }

  function draw() {
    const rows = lanes();
    const wrap = el.querySelector('.chart-wrap');
    const W = Math.max(900, wrap.clientWidth - 24);
    x = d3.scaleLinear().domain([0, LANE_MAX]).range([M.left, W - M.right]);

    // lane heights vary: collapsed lanes are LANE tall, expanded ones grow to fit their text
    const layouts = rows.map(s => layoutFor(s, W));
    const ys = [];
    let acc = M.top;
    layouts.forEach(l => { ys.push(acc); acc += l.h; });
    const bodyH = acc - M.top;
    const H = acc + M.bottom;

    wrap.innerHTML = '';
    svg = d3.select(wrap).append('svg').attr('width', W).attr('height', H);

    // night shading (00:00-06:00 and 21:00-24:00)
    [[0, 360], [1260, LANE_MAX]].forEach(([a, b]) =>
      svg.append('rect').attr('x', x(a)).attr('y', M.top).attr('width', x(b) - x(a))
        .attr('height', bodyH).attr('fill', 'var(--night)').attr('opacity', .7));

    // axis
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${M.top - 6})`)
      .call(d3.axisTop(x).tickValues(d3.range(0, LANE_MAX + 1, 180)).tickFormat(App.fmt).tickSize(-6));

    // lanes
    const g = svg.append('g');
    rows.forEach((s, i) => {
      const L = layouts[i];
      const lane = g.append('g').attr('transform', `translate(0,${ys[i]})`).style('cursor', 'pointer');

      // clicking anywhere in a lane opens / closes it (name, photo and flags handle their own clicks)
      lane.on('click', ev => {
        ev.stopPropagation();
        closePop();
        if (expanded.has(s.id)) expanded.delete(s.id); else expanded.add(s.id);
        draw();
      });

      lane.append('rect').attr('class', 'lane-bg' + (s.flagged ? ' flagged' : ''))
        .attr('x', M.left).attr('width', x(LANE_MAX) - M.left).attr('height', L.h - 3).attr('rx', 4)
        .attr('opacity', .55);

      // student photo to the left of the name (HTML from App.avatar, hosted in a foreignObject)
      if (typeof App.avatar === 'function') {
        lane.append('foreignObject')
          .attr('x', 6).attr('y', (LANE - 3 - AVATAR) / 2).attr('width', AVATAR).attr('height', AVATAR)
          .on('click', ev => { ev.stopPropagation(); App.selectStudent(s.id); })
          .append('xhtml:div')
          .style('width', AVATAR + 'px').style('height', AVATAR + 'px').style('line-height', 0)
          .html(`${App.avatar(s, AVATAR)}`);
      }

      lane.append('text')
        .attr('class', 'lane-label' + (App.state.selectedStudent === s.id ? ' selected' : ''))
        .attr('x', typeof App.avatar === 'function' ? AVATAR + 16 : 10)
        .attr('y', LANE / 2 - 1).attr('text-anchor', 'start').attr('dominant-baseline', 'middle')
        .text(s.name + (s.flagged ? ` · ${s.score.toFixed(1)}` : ''))
        .on('click', ev => { ev.stopPropagation(); App.selectStudent(s.id); });

      // open / closed marker
      lane.append('text')
        .attr('x', M.left - 10).attr('y', LANE / 2 - 1).attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .attr('fill', 'var(--muted)').attr('font-size', 12).style('pointer-events', 'none')
        .text(L.open ? '▾' : '▸');

      if (!L.open) {
        // stays
        (showStays ? s.stays : []).forEach(st => {
          lane.append('rect')
            .attr('x', x(st.start)).attr('y', 4)
            .attr('width', Math.max(3, x(st.end) - x(st.start))).attr('height', LANE - 24).attr('rx', 3)
            .attr('fill', 'var(--stay)')
            .append('title').text(spanText(st.place, st.start, st.end));
        });

        // claims
        (showClaims ? s.claims : []).forEach(c => {
          lane.append('rect')
            .attr('x', x(c.start)).attr('y', 15)
            .attr('width', Math.max(3, x(c.end) - x(c.start))).attr('height', LANE - 24).attr('rx', 3)
            .attr('fill', 'var(--claim)').attr('opacity', .6)
            .append('title').text(spanText(c.place, c.start, c.end));
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
      } else {
        // ---- expanded: one section per kind, each bar with its text underneath ----
        lane.append('text')
          .attr('x', M.left + 8).attr('y', LANE / 2 - 1).attr('dominant-baseline', 'middle')
          .attr('fill', 'var(--muted)').attr('font-size', 11).style('pointer-events', 'none').text(L.summary);

        L.sections.forEach(sec => {
          lane.append('text')
            .attr('x', AVATAR + 16).attr('y', sec.y + (sec.items.length ? sec.barH / 2 : SUB / 2))
            .attr('dominant-baseline', 'middle').attr('fill', 'var(--muted)').attr('font-size', 10)
            .attr('letter-spacing', '.08em').style('pointer-events', 'none').text(sec.label.toUpperCase());

          sec.items.forEach(it => {
            const isFlag = sec.key === 'flags';
            const colour = isFlag ? (sevColor[it.src.severity] || sevColor.low) : sec.colour;
            const textTop = sec.y + sec.barH + 4 + it.row * SUB;

            // thin line from the bar down to its text
            lane.append('line')
              .attr('x1', it.x0 + .5).attr('x2', it.x0 + .5).attr('y1', sec.y + sec.barH).attr('y2', textTop + 2)
              .attr('stroke', colour).attr('stroke-opacity', .35).style('pointer-events', 'none');

            if (isFlag) {
              lane.append('rect')
                .attr('x', it.x0 - 1).attr('y', sec.y).attr('width', it.w + 2).attr('height', sec.barH).attr('rx', 4)
                .attr('fill', 'var(--night)').attr('fill-opacity', 0)
                .attr('stroke', colour).attr('stroke-width', 2)
                .style('pointer-events', 'all').style('cursor', 'pointer')
                .on('mouseenter', function () { d3.select(this).transition().duration(120).attr('fill-opacity', 0.65); })
                .on('mouseleave', function () { d3.select(this).transition().duration(120).attr('fill-opacity', 0); })
                .on('click', ev => { ev.stopPropagation(); showPop(ev.currentTarget, s, it.src); })
                .append('title').text(`${it.src.rule} (${it.src.severity}): ${it.src.detail}`);
            } else {
              lane.append('rect')
                .attr('x', it.x0).attr('y', sec.y).attr('width', it.w).attr('height', sec.barH).attr('rx', 3)
                .attr('fill', colour).attr('opacity', sec.key === 'claims' ? .6 : 1)
                .append('title').text(it.text);
            }

            lane.append('text')
              .attr('x', it.tx).attr('y', textTop + FONT).attr('font-size', FONT)
              .attr('fill', isFlag ? colour : 'var(--text)')
              .attr('stroke', 'var(--bg-2)').attr('stroke-width', 3).attr('stroke-linejoin', 'round')
              .style('paint-order', 'stroke').style('pointer-events', 'none')
              .text(it.text);
          });

          // items with no time can't sit on the axis, so they are listed as text
          sec.lines.forEach((ln, k) => {
            const isFlag = sec.key === 'flags';
            lane.append('text')
              .attr('x', M.left + 8).attr('y', sec.linesY + k * SUB + FONT).attr('font-size', FONT)
              .attr('font-style', 'italic')
              .attr('fill', isFlag ? (sevColor[ln.src.severity] || sevColor.low) : 'var(--muted)')
              .style('pointer-events', 'none')
              .text(fitText(ln.text, L.maxText))
              .append('title').text(isFlag ? `${ln.src.rule} (${ln.src.severity}): ${ln.src.detail}` : ln.text);
          });
        });

        if (!L.sections.length) {
          lane.append('text').attr('x', M.left + 8).attr('y', LANE + 14).attr('font-size', FONT)
            .attr('fill', 'var(--muted)').style('pointer-events', 'none')
            .text('Nothing to show. Turn stays or claims back on, or this student has no flags.');
        }
      }
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
            <span class="muted" style="font-size:13px">Click a lane to expand it, or a name or photo to open their card. Drag the scrubber or click the time axis to move the clock.</span>
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