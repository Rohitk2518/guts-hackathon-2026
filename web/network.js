/* network.js: D3 force graph + reveal animation (Danielle)
 * Before reveal: kingpin looks like any clean student.
 * Reveal: kingpin pulls to centre in gold, dashed links animate, unconnected clean students fade.
 *
 * Built to cope with the real data.json: ~160 students and thousands of edges with weights well above 1.
 * - edges that reference an unknown student id are skipped (and logged), not allowed to crash the graph
 * - only the strongest edges are drawn by default (slider lets you lower the cut-off)
 * - widths, distances and node sizes are scaled from the data, not hard-coded for 0..1 weights
 *
 * Navigation:
 * - mouse wheel / pinch zooms, drag the background to pan
 * - button bar along the bottom: pan arrows, zoom out / in, fit
 * - clicking a node zooms in and centres it (and opens its interrogation card)
 */
(function () {
  let sim, svg, layer, zoom, avSel, nodeSel, linkSel, labelSel, ringSel, el, data, W, H, focusKey = null;

  // suspicion band from the score; the legend uses the same bands
  const band = s => (s.score >= 7 ? 'high' : s.score >= 4 ? 'med' : s.score > 0 ? 'low' : 'clean');
  const COLOR = { high: 'var(--alert)', med: 'var(--warn)', low: 'var(--low)', clean: 'var(--clean)' };
  const nodeColor = s => COLOR[band(s)];
  const GROUPS = [['high', 'High score'], ['med', 'Medium'], ['low', 'Low'], ['clean', 'Clean'], ['kp', 'Mastermind']];
  const inGroup = (key, s) => (key === 'kp' ? s.id === data.kingpin : band(s) === key);

  function degree(id) {
    return data.edges.filter(e => e.a === id || e.b === id).reduce((t, e) => t + e.weight, 0);
  }

  /* ---- zoom / pan ---- */
  function zoomToNode(d) {
    const k = Math.max(d3.zoomTransform(svg.node()).k, CLICK_ZOOM);
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-d.x, -d.y);
    svg.transition().duration(600).call(zoomB.transform, t);
  }

  function control(action) {
    if (!svg) return;
    const k = d3.zoomTransform(svg.node()).k;
    const t = svg.transition().duration(250);
    switch (action) {
      case 'in':    zoomB.scaleBy(t, 1.5); break;
      case 'out':   zoomB.scaleBy(t, 1 / 1.5); break;
      case 'left':  zoomB.translateBy(t, PAN_STEP / k, 0); break;   // moving the view left moves the content right
      case 'right': zoomB.translateBy(t, -PAN_STEP / k, 0); break;
      case 'up':    zoomB.translateBy(t, 0, PAN_STEP / k); break;
      case 'down':  zoomB.translateBy(t, 0, -PAN_STEP / k); break;
      case 'fit':
        focusId = null; updateLabels();
        zoomB.transform(t, d3.zoomIdentity);
        break;
    }
  }

  /* ---- labels: flagged students, the kingpin on reveal, and whichever node was last clicked ---- */
  function labelOpacity(d, on) {
    const kp = data.kingpin;
    if (d.id === focusId) return 1;
    if (on && d.id === kp) return 1;
    const faded = on && !d.s.flagged && !connected.has(d.id);
    return d.s.flagged && !faded ? 1 : 0;
  }
  function updateLabels() {
    if (labelSel) labelSel.attr('opacity', d => labelOpacity(d, App.state.revealMode));
  }

  function build() {
    if (sim) sim.stop();
    selectEdges();
    focusId = null;

    const wrap = el.querySelector('#network-wrap');
    wrap.innerHTML = `<svg id="network-svg"><defs><clipPath id="net-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs></svg>
      <div class="net-controls">
        <button class="icon-btn" data-z="in" aria-label="Zoom in">+</button>
        <button class="icon-btn" data-z="out" aria-label="Zoom out">&minus;</button>
        <button class="icon-btn" data-z="reset" aria-label="Fit everyone"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg></button>
        <button class="icon-btn" data-z="full" aria-label="Full screen"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg></button>
      </div>`;
    const node = wrap.querySelector('svg');
    W = node.clientWidth || 900; H = node.clientHeight || 640;
    svg = d3.select(node);

    // everything that should zoom/pan lives inside this group
    viewport = svg.append('g').attr('class', 'viewport');
    zoomB = d3.zoom().scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on('zoom', ev => viewport.attr('transform', ev.transform));
    svg.call(zoomB).on('dblclick.zoom', null).style('cursor', 'grab');

    // weighted degree over all valid edges, scaled into a modest radius range
    const deg = {};
    validEdges.forEach(e => { deg[e.a] = (deg[e.a] || 0) + e.weight; deg[e.b] = (deg[e.b] || 0) + e.weight; });
    const maxDeg = d3.max(Object.values(deg)) || 1;
    const radius = s => 6 + 6 * Math.sqrt((deg[s.id] || 0) / maxDeg) + (s.flagged ? 3 : 0);

    const nodes = data.students.map(s => ({ id: s.id, s, r: radius(s) }));
    const idx = Object.fromEntries(nodes.map(n => [n.id, n]));
    const links = shownEdges.map(e => ({ source: idx[e.a], target: idx[e.b], e }));

    const width = d3.scaleSqrt().domain([0, maxW]).range([.6, 5]);
    const strength = w => 0.03 + 0.5 * (w / maxW);
    const distance = w => 150 - 100 * (w / maxW);

    linkSel = viewport.append('g').selectAll('line').data(links).join('line')
      .attr('class', 'link').attr('stroke-width', d => width(d.e.weight)).attr('opacity', .35);
    linkSel.append('title').text(d =>
      `${App.byId[d.e.a].name} and ${App.byId[d.e.b].name}: ${d.e.overlap_min} min at ${placeName(d.e.place)}`);

    const g = viewport.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer')
      .on('click', (ev, d) => {
        focusId = d.id;
        updateLabels();
        zoomToNode(d);
        App.selectStudent(d.id);
      })
      .call(d3.drag()
        .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); if (!(App.state.revealMode && d.id === data.kingpin)) { d.fx = null; d.fy = null; } }));

    ringSel = g.append('circle').attr('r', d => d.r).attr('fill', 'none').attr('stroke', 'var(--gold)').attr('stroke-width', 2).attr('opacity', 0);
    nodeSel = g.append('circle').attr('r', d => d.r).attr('fill', d => nodeColor(d.s))
      .attr('stroke', 'var(--surface)').attr('stroke-width', 2);
    // face inside the coloured disc; the disc's edge still shows the suspicion colour
    avSel = g.append('image').attr('class', 'net-av').attr('href', d => `avatars/${d.id}.svg`).attr('clip-path', 'url(#net-clip)')
      .attr('x', d => -d.r * .82).attr('y', d => -d.r * .82).attr('width', d => d.r * 1.64).attr('height', d => d.r * 1.64);
    g.append('title').text(d => `${d.s.name}${d.s.score > 0 ? ', score ' + d.s.score.toFixed(1) : ''}`);
    labelSel = g.append('text').attr('class', 'node-label').attr('dy', d => d.r + 13).text(d => d.s.name.split(' ')[0]);

    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).distance(d => distance(d.e.weight)).strength(d => strength(d.e.weight)))
      .force('charge', d3.forceManyBody().strength(charge))
      .force('collide', d3.forceCollide(d => d.r + 3))
      .force('x', d3.forceX(W / 2).strength(.06))   // gentle pull stops loose nodes drifting away
      .force('y', d3.forceY(H / 2).strength(.08))
      .force('bounds', clampToBounds)
      .stop();

    // settle the layout before the first paint so the opening view is already contained
    for (let i = 0; i < 250; i++) sim.tick();
    render();
    sim.on('tick', render).alpha(.15).restart();

    applyReveal(App.state.revealMode, false);
    controls(wrap);
  }

  // zoom buttons and full screen (bottom-right of the graph)
  function controls(wrap) {
    wrap.querySelector('.net-controls').onclick = e => {
      const z = e.target.closest('[data-z]')?.dataset.z, t = svg.transition().duration(350);
      if (z === 'in') t.call(zoom.scaleBy, 1.4);
      if (z === 'out') t.call(zoom.scaleBy, 1 / 1.4);
      if (z === 'reset') { applyFocus(null); }
      if (z === 'full') document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen?.();
    };
    // the layout was centred for the old size; shift it to the centre of the new one
    wrap.onfullscreenchange = () => {
      if (!svg) return;
      const n = svg.node();
      svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate((n.clientWidth - W) / 2, (n.clientHeight - H) / 2));
      wrap.querySelector('[data-z=full]').setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Full screen');
    };
  }

  // legend click: zoom to that group and fade everyone else; same key again clears
  function applyFocus(key) {
    focusKey = key;
    el.querySelectorAll('.legend-btn').forEach(b => b.classList.toggle('active', b.dataset.g === key));
    if (!key) {
      applyReveal(App.state.revealMode, true);
      const n = svg.node();   // centre for the current size (differs in full screen)
      svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate((n.clientWidth - W) / 2, (n.clientHeight - H) / 2));
      return;
    }
    const on = d => inGroup(key, d.s), t = d3.transition().duration(500);
    nodeSel.transition(t).attr('opacity', d => (on(d) ? 1 : .1));
    avSel.transition(t).attr('opacity', d => (on(d) ? 1 : .1));
    labelSel.transition(t).attr('opacity', d => (on(d) ? 1 : .05)).text(d => (on(d) ? d.s.name : d.s.name.split(' ')[0]));
    linkSel.transition(t).attr('opacity', d => (on(d.source) || on(d.target) ? .8 : .04));
    ringSel.attr('class', d => (on(d) ? 'pulse' : null)).attr('stroke', d => nodeColor(d.s)).attr('opacity', d => (on(d) ? .8 : 0));
    // wait for the layout to settle a little, then frame the group
    setTimeout(() => {
      const pts = sim.nodes().filter(on);
      if (!pts.length || !svg) return;
      const [x0, x1] = d3.extent(pts, n => n.x), [y0, y1] = d3.extent(pts, n => n.y);
      const k = Math.max(.4, Math.min(1.8, .8 / Math.max((x1 - x0 + 80) / W, (y1 - y0 + 80) / H)));
      const n = svg.node(), cw = n.clientWidth, ch = n.clientHeight;
      svg.transition().duration(800).call(zoom.transform, d3.zoomIdentity.translate(cw / 2, ch / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    }, 300);
  }

  function applyReveal(on, animate) {
    if (!sim) return;
    const kp = data.kingpin;
    connected = new Set([kp]);
    shownEdges.forEach(e => { if (e.a === kp) connected.add(e.b); if (e.b === kp) connected.add(e.a); });
    const faded = d => on && !d.s.flagged && !connected.has(d.id);
    const t = d3.transition().duration(animate === false ? 0 : 900);

    nodeSel.transition(t)
      .attr('fill', d => (on && d.id === kp ? 'var(--gold)' : nodeColor(d.s)))
      .attr('r', d => (on && d.id === kp ? d.r * 1.6 : d.r))
      .attr('opacity', d => (on && !d.s.flagged && !connected.has(d.id) ? .15 : 1));
    avSel.transition(t).attr('opacity', d => (on && !d.s.flagged && !connected.has(d.id) ? .15 : 1));   // faces fade with their disc
    labelSel.transition(t)
      .attr('opacity', d => labelOpacity(d, on))
      .attr('dy', d => (on && d.id === kp ? d.r * 1.8 : d.r) + 12)
      .text(d => (on && d.id === kp ? d.s.name : firstName(d.s)));
    ringSel.attr('class', d => (on && d.id === kp ? 'pulse' : null))
      .attr('opacity', d => (on && d.id === kp ? .8 : 0));
    linkSel.classed('kingpin-link', d => on && (d.e.a === kp || d.e.b === kp));
    linkSel.transition(t)
      .attr('stroke', d => (on && (d.e.a === kp || d.e.b === kp) ? 'var(--gold)' : null))
      .attr('opacity', d => (on ? ((d.e.a === kp || d.e.b === kp) ? 1 : .06) : .35));

    // pin kingpin to centre on reveal
    sim.nodes().forEach(n => {
      if (n.id === kp) { n.fx = on ? W / 2 : null; n.fy = on ? H / 2 : null; }
    });
    sim.alpha(.9).restart();
  }

  function button() {
    const b = el.querySelector('#reveal');
    b.textContent = App.state.revealMode ? '↩ Hide the Mastermind' : '👁 Reveal the Mastermind';
    const k = el.querySelector('#kp-name');
    k.textContent = App.state.revealMode ? `${App.byId[data.kingpin].name} is the mastermind.` : '';
  }

  function updateEdgeInfo() {
    const info = el.querySelector('#edge-info');
    if (info) info.textContent = `${shownEdges.length} of ${validEdges.length} links shown` +
      (skipped ? ` · ${skipped} skipped (unknown student id)` : '');
  }

  window.Views = window.Views || {};
  window.Views.network = {
    mount(container, d) {
      el = container; data = d;
      prepareEdges();
      // layout is set inline so the controls sit over the bottom of the graph even if style.css is stale
      el.innerHTML = `
        <div class="toolbar">
          <h2 style="margin:0">Network</h2>
          <button class="btn gold" id="reveal"></button>
          <strong id="kp-name" style="color:var(--gold)"></strong>
          <label>Min link strength
            <input type="range" id="minw" min="0" max="${Math.ceil(maxW * 20) / 20}" step="0.05" value="${minW}">
          </label>
          <span class="muted" style="font-size:13px" id="edge-info"></span>
        </div>
        <div class="net-stage" style="position:relative">
          <div id="network-wrap"></div>
          <div class="net-controls" role="toolbar" aria-label="Network navigation"
               style="position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;z-index:5">
            <button class="net-btn" data-act="left"  title="Pan left"  aria-label="Pan left">◀</button>
            <button class="net-btn" data-act="up"    title="Pan up"    aria-label="Pan up">▲</button>
            <button class="net-btn" data-act="down"  title="Pan down"  aria-label="Pan down">▼</button>
            <button class="net-btn" data-act="right" title="Pan right" aria-label="Pan right">▶</button>
            <span class="net-sep"></span>
            <button class="net-btn" data-act="out"   title="Zoom out"  aria-label="Zoom out">−</button>
            <button class="net-btn" data-act="in"    title="Zoom in"   aria-label="Zoom in">+</button>
            <button class="net-btn net-fit" data-act="fit" title="Reset view" aria-label="Reset view">Fit</button>
          </div>
        </div>
        <div class="legend">
          <span><i style="background:var(--alert);border-radius:50%"></i>High score</span>
          <span><i style="background:var(--warn);border-radius:50%"></i>Medium</span>
          <span><i style="background:var(--low);border-radius:50%"></i>Low</span>
          <span><i style="background:var(--clean);border-radius:50%"></i>Clean</span>
          <span><i style="background:var(--gold);border-radius:50%"></i>Mastermind</span>
          <span>Line width = time together, corrected for crowd size. Scroll to zoom, drag to pan, click a node to centre it.</span>
        </div>`;
      el.querySelector('#reveal').onclick = () => App.setState({ revealMode: !App.state.revealMode });
      el.querySelector('#minw').onchange = e => { minW = +e.target.value; build(); };
      el.querySelectorAll('.net-btn').forEach(b => { b.onclick = () => control(b.dataset.act); });
      build();
      button();
    },
    update(state, patch) {
      if ('revealMode' in patch) {
        // the kingpin is pinned to the middle of the layout, so reset the view or it can end up off-screen
        if (state.revealMode) control('fit');
        applyReveal(state.revealMode, true); button();
      }
    },
    unmount() { if (document.fullscreenElement) document.exitFullscreen(); if (sim) sim.stop(); sim = null; svg = null; focusKey = null; }
  };
})();
