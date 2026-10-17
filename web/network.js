/* network.js: D3 force graph + reveal animation (Danielle)
 * Before reveal: kingpin looks like any clean student.
 * Reveal: kingpin pulls to centre in gold, dashed links animate, unconnected clean students fade.
 */
(function () {
  let sim, svg, nodeSel, linkSel, labelSel, ringSel, el, data, W, H;

  const nodeColor = s => (s.flagged ? (s.score >= 7 ? 'var(--alert)' : s.score >= 4 ? 'var(--warn)' : 'var(--low)') : 'var(--clean)');

  function degree(id) {
    return data.edges.filter(e => e.a === id || e.b === id).reduce((t, e) => t + e.weight, 0);
  }

  function build() {
    const wrap = el.querySelector('#network-wrap');
    wrap.innerHTML = '<svg id="network-svg"></svg>';
    const node = wrap.querySelector('svg');
    W = node.clientWidth || 900; H = node.clientHeight || 640;
    svg = d3.select(node);

    const nodes = data.students.map(s => ({ id: s.id, s, r: 9 + degree(s.id) * 6 }));
    const idx = Object.fromEntries(nodes.map(n => [n.id, n]));
    const links = data.edges.map(e => ({ source: idx[e.a], target: idx[e.b], e }));

    linkSel = svg.append('g').selectAll('line').data(links).join('line')
      .attr('class', 'link').attr('stroke-width', d => 1 + d.e.weight * 6).attr('opacity', .7);
    linkSel.append('title').text(d => `${App.byId[d.e.a].name} and ${App.byId[d.e.b].name}: ${d.e.overlap_min} min at ${(App.placeById[d.e.place] || {}).name || d.e.place}`);

    const g = svg.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer')
      .on('click', (ev, d) => App.selectStudent(d.id))
      .call(d3.drag()
        .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); if (!(App.state.revealMode && d.id === data.kingpin)) { d.fx = null; d.fy = null; } }));

    ringSel = g.append('circle').attr('r', d => d.r).attr('fill', 'none').attr('stroke', 'var(--gold)').attr('stroke-width', 2).attr('opacity', 0);
    nodeSel = g.append('circle').attr('r', d => d.r).attr('fill', d => nodeColor(d.s))
      .attr('stroke', 'var(--surface)').attr('stroke-width', 2);
    g.append('title').text(d => `${d.s.name}${d.s.flagged ? ', score ' + d.s.score.toFixed(1) : ''}`);
    labelSel = g.append('text').attr('class', 'node-label').attr('dy', d => d.r + 13).text(d => d.s.name.split(' ')[0]);

    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).distance(d => 190 - d.e.weight * 120).strength(d => .2 + d.e.weight * .6))
      .force('charge', d3.forceManyBody().strength(-380))
      .force('collide', d3.forceCollide(d => d.r + 12))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .on('tick', () => {
        linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        g.attr('transform', d => `translate(${d.x},${d.y})`);
      });

    applyReveal(App.state.revealMode, false);
  }

  function applyReveal(on, animate) {
    if (!sim) return;
    const kp = data.kingpin;
    const connected = new Set([kp]);
    data.edges.forEach(e => { if (e.a === kp) connected.add(e.b); if (e.b === kp) connected.add(e.a); });
    const t = d3.transition().duration(animate === false ? 0 : 900);

    nodeSel.transition(t)
      .attr('fill', d => (on && d.id === kp ? 'var(--gold)' : nodeColor(d.s)))
      .attr('r', d => (on && d.id === kp ? d.r * 1.6 : d.r))
      .attr('opacity', d => (on && !d.s.flagged && !connected.has(d.id) ? .15 : 1));
    labelSel.transition(t)
      .attr('opacity', d => (on && !d.s.flagged && !connected.has(d.id) ? .1 : 1))
      .text(d => (on && d.id === kp ? d.s.name : d.s.name.split(' ')[0]));
    ringSel.attr('class', d => (on && d.id === kp ? 'pulse' : null))
      .attr('opacity', d => (on && d.id === kp ? .8 : 0));
    linkSel.classed('kingpin-link', d => on && (d.e.a === kp || d.e.b === kp));
    linkSel.transition(t)
      .attr('stroke', d => (on && (d.e.a === kp || d.e.b === kp) ? 'var(--gold)' : null))
      .attr('opacity', d => (on ? ((d.e.a === kp || d.e.b === kp) ? 1 : .15) : .7));

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

  window.Views = window.Views || {};
  window.Views.network = {
    mount(container, d) {
      el = container; data = d;
      el.innerHTML = `
        <div class="toolbar">
          <h2 style="margin:0">Network</h2>
          <button class="btn gold" id="reveal"></button>
          <strong id="kp-name" style="color:var(--gold)"></strong>
          <span class="muted" style="font-size:13px">Line width = time together, corrected for crowd size. Node size = connections.</span>
        </div>
        <div id="network-wrap"></div>
        <div class="legend">
          <span><i style="background:var(--alert);border-radius:50%"></i>High score</span>
          <span><i style="background:var(--warn);border-radius:50%"></i>Medium</span>
          <span><i style="background:var(--low);border-radius:50%"></i>Low</span>
          <span><i style="background:var(--clean);border-radius:50%"></i>Clean</span>
          <span><i style="background:var(--gold);border-radius:50%"></i>Mastermind</span>
        </div>`;
      el.querySelector('#reveal').onclick = () => App.setState({ revealMode: !App.state.revealMode });
      build();
      button();
    },
    update(state, patch) {
      if ('revealMode' in patch) { applyReveal(state.revealMode, true); button(); }
    },
    unmount() { if (sim) sim.stop(); sim = null; }
  };
})();
