/* network.js: D3 force graph + reveal animation (Danielle)
 * Before reveal: kingpin looks like any clean student.
 * Reveal: kingpin pulls to centre in gold, dashed links animate, unconnected clean students fade.
 *
 * Built to cope with the real data.json: ~160 students and thousands of edges with weights well above 1.
 * - edges that reference an unknown student id are skipped (and logged), not allowed to crash the graph
 * - only the strongest edges are drawn by default (slider lets you lower the cut-off)
 * - widths, distances and node sizes are scaled from the data, not hard-coded for 0..1 weights
 */
(function () {
  const MAX_DEFAULT_EDGES = 500;   // how many of the strongest links to draw initially
  const KINGPIN_EXTRA_EDGES = 15;  // kingpin's strongest links are always available for the reveal

  let sim, svg, nodeSel, linkSel, labelSel, ringSel, el, data, W, H;
  let validEdges = [], shownEdges = [], skipped = 0, maxW = 1, minW = null;

  const nodeColor = s => (s.flagged ? (s.score >= 6 ? 'var(--alert)' : s.score >= 3 ? 'var(--warn)' : 'var(--low)') : 'var(--clean)');
  const placeName = p => (App.placeById[p] || {}).name || String(p).replace(/\b\w/g, c => c.toUpperCase());
  const firstName = s => s.name.split(' ')[0];

  /* drop edges whose endpoints aren't in students[] (e.g. a log row with a mistyped student id) */
  function prepareEdges() {
    const ids = new Set(data.students.map(s => s.id));
    const bad = new Set();
    validEdges = data.edges.filter(e => {
      const ok = ids.has(e.a) && ids.has(e.b);
      if (!ok) { if (!ids.has(e.a)) bad.add(e.a); if (!ids.has(e.b)) bad.add(e.b); }
      return ok;
    });
    skipped = data.edges.length - validEdges.length;
    if (skipped) console.warn(`network: skipped ${skipped} edges with unknown student ids:`, [...bad]);
    maxW = d3.max(validEdges, e => e.weight) || 1;
    if (minW === null) {
      const sorted = validEdges.map(e => e.weight).sort(d3.descending);
      minW = sorted.length > MAX_DEFAULT_EDGES ? sorted[MAX_DEFAULT_EDGES - 1] : 0;
    }
  }

  function selectEdges() {
    const kp = data.kingpin;
    const keep = new Set(validEdges.filter(e => e.weight >= minW));
    validEdges.filter(e => e.a === kp || e.b === kp)
      .sort((a, b) => b.weight - a.weight).slice(0, KINGPIN_EXTRA_EDGES)
      .forEach(e => keep.add(e));
    shownEdges = [...keep];
  }

  function build() {
    if (sim) sim.stop();
    selectEdges();

    const wrap = el.querySelector('#network-wrap');
    wrap.innerHTML = '<svg id="network-svg"></svg>';
    const node = wrap.querySelector('svg');
    W = node.clientWidth || 900; H = node.clientHeight || 640;
    svg = d3.select(node);
    layer = svg.append('g');
    zoom = d3.zoom().scaleExtent([.4, 4]).on('zoom', ev => layer.attr('transform', ev.transform));
    svg.call(zoom);

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

    linkSel = svg.append('g').selectAll('line').data(links).join('line')
      .attr('class', 'link').attr('stroke-width', d => width(d.e.weight)).attr('opacity', .35);
    linkSel.append('title').text(d =>
      `${App.byId[d.e.a].name} and ${App.byId[d.e.b].name}: ${d.e.overlap_min} min at ${placeName(d.e.place)}`);

    const g = layer.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer')
      .on('click', (ev, d) => App.selectStudent(d.id))
      .call(d3.drag()
        .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); if (!(App.state.revealMode && d.id === data.kingpin)) { d.fx = null; d.fy = null; } }));

    ringSel = g.append('circle').attr('r', d => d.r).attr('fill', 'none').attr('stroke', 'var(--gold)').attr('stroke-width', 2).attr('opacity', 0);
    nodeSel = g.append('circle').attr('r', d => d.r).attr('fill', d => nodeColor(d.s))
      .attr('stroke', '#0d1017').attr('stroke-width', 1.5);
    g.append('title').text(d => `${d.s.name}${d.s.flagged ? ' · score ' + d.s.score.toFixed(1) : ''}`);
    // with ~160 nodes only flagged students are labelled up front; everyone else shows a name on hover
    labelSel = g.append('text').attr('class', 'node-label').attr('dy', d => d.r + 12)
      .attr('opacity', d => (d.s.flagged ? 1 : 0)).text(d => firstName(d.s));

    // keep every node (plus its label and the enlarged kingpin) inside the SVG
    const clampToBounds = () => nodes.forEach(d => {
      const pad = d.r * 1.6 + 8;
      d.x = Math.max(pad, Math.min(W - pad, d.x));
      d.y = Math.max(pad, Math.min(H - pad - 14, d.y));
    });

    // scale repulsion with node count so crowded graphs still fit
    const charge = -Math.min(380, 9000 / Math.max(1, nodes.length));

    const render = () => {
      linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      g.attr('transform', d => `translate(${d.x},${d.y})`);
    };

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
    updateEdgeInfo();
  }

  function applyReveal(on, animate) {
    if (!sim) return;
    const kp = data.kingpin;
    const connected = new Set([kp]);
    shownEdges.forEach(e => { if (e.a === kp) connected.add(e.b); if (e.b === kp) connected.add(e.a); });
    const faded = d => on && !d.s.flagged && !connected.has(d.id);
    const t = d3.transition().duration(animate === false ? 0 : 900);

    nodeSel.transition(t)
      .attr('fill', d => (on && d.id === kp ? 'var(--gold)' : nodeColor(d.s)))
      .attr('r', d => (on && d.id === kp ? d.r * 1.8 : d.r))
      .attr('opacity', d => (faded(d) ? .15 : 1));
    labelSel.transition(t)
      .attr('opacity', d => (on && d.id === kp ? 1 : (d.s.flagged && !faded(d) ? 1 : 0)))
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
    b.textContent = App.state.revealMode ? 'Hide the mastermind' : 'Reveal the mastermind';
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
        <div id="network-wrap"></div>
        <div class="legend">
          <span><i style="background:var(--alert);border-radius:50%"></i>High score</span>
          <span><i style="background:var(--warn);border-radius:50%"></i>Medium</span>
          <span><i style="background:var(--low);border-radius:50%"></i>Low</span>
          <span><i style="background:var(--clean);border-radius:50%"></i>Clean</span>
          <span><i style="background:var(--gold);border-radius:50%"></i>Mastermind</span>
          <span>Line width = time together, corrected for crowd size. Hover a node for its name.</span>
        </div>`;
      el.querySelector('#reveal').onclick = () => App.setState({ revealMode: !App.state.revealMode });
      el.querySelector('#minw').onchange = e => { minW = +e.target.value; build(); };
      build();
      button();
    },
    update(state, patch) {
      if ('revealMode' in patch) { applyReveal(state.revealMode, true); button(); if (focusKey) applyFocus(focusKey); }
    },
    unmount() { if (sim) sim.stop(); sim = null; svg = null; focusKey = null; }
  };
})();
