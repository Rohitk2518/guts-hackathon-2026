/* summary.js: opening screen (Danielle) */
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function countUp(el, target, ms) {
    const start = performance.now();
    (function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  }

  window.Views = window.Views || {};
  window.Views.summary = {
    mount(el, data) {
      const flagged = data.students.filter(s => s.flagged);
      const rules = new Set();
      flagged.forEach(s => s.flags.forEach(f => rules.add(f.rule)));
      const top = data.findings.slice().sort((a, b) => a.rank - b.rank).slice(0, 3);
      const pad = n => String(n).padStart(2, '0');

      el.innerHTML = `
        <section class="hero">
          <div class="eyebrow">CASE FILE · UNIVERSITY OF GLASGOW</div>
          <h1>Someone planned to burn down the Boyd Orr.</h1>
          <p>We cross-checked ${data.students.length} students' testimonies against building access logs and lecture timetables.</p>
        </section>

        <section class="stats">
          <div class="card stat alert"><div class="num" data-n="${flagged.length}">0</div><div class="label">Suspects flagged</div></div>
          <div class="card stat"><div class="num" data-n="${data.students.length}">0</div><div class="label">Students checked</div></div>
          <div class="card stat"><div class="num" data-n="${rules.size}">0</div><div class="label">Rule types triggered</div></div>
          <div class="card stat gold"><div class="num">1</div><div class="label">Mastermind</div></div>
        </section>

        <div class="card kingpin-tease">
          One person is orchestrating this and looks completely clean.
          Their name is <span class="redacted">Redacted Name</span>.
        </div>

        <h2 style="margin-top:32px">Top 3 anomalies</h2>
        <section class="findings">
          ${top.map(f => `
            <article class="card finding" data-t="${f.time_start}" data-rank="${f.rank}">
              <div class="rank">${f.rank}</div>
              <div class="when">${App.fmt(f.time_start)} to ${App.fmt(f.time_end)} · ${esc((App.placeById[f.place] || {}).name || f.place)}</div>
              <div>${esc(f.text)}</div>
            </article>`).join('')}
        </section>

        <div class="cta">
          <button class="btn" id="play">▶ Play the Case</button>
          <button class="btn secondary" id="to-timeline">Open the timeline</button>
          <button class="btn secondary" id="to-network">See the network</button>
        </div>`;

      el.querySelectorAll('.stat .num[data-n]').forEach(n => countUp(n, +n.dataset.n, 900));
      el.querySelectorAll('.finding').forEach(c => {
        c.onclick = () => App.setState({ currentTime: +c.dataset.t, mode: 'timeline' });
      });
      el.querySelector('#play').onclick = () => App.setState({ storyStep: 0, mode: 'story' });
      el.querySelector('#to-timeline').onclick = () => App.setState({ mode: 'timeline' });
      el.querySelector('#to-network').onclick = () => App.setState({ mode: 'network' });
    }
  };
})();
