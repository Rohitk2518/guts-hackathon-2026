/* summary.js: opening screen, written as a case brief */
(function () {
  const esc = App.esc;

  window.Views = window.Views || {};
  window.Views.summary = {
    mount(el, data) {
      const flagged = data.students.filter(s => s.flagged).length;
      const swipes = data.students.reduce((n, s) => n + s.stays.length, 0);
      const top = data.findings.slice().sort((a, b) => a.rank - b.rank).slice(0, 3);
      const place = App.placeName;
      const suspects = App.rankSuspects().slice(0, 3);

      el.innerHTML = `
        <section class="brief">
          <h1>Someone planned to burn down the Boyd Orr.</h1>
          <p class="lead">
            We checked <b>${data.students.length} students</b> against ${swipes} building log entries and their own statements.
            <b class="sus">${flagged} stories don't hold up.</b>
            One person organised it, and on paper they look clean. Their name is <span class="redacted">hidden</span>.
          </p>

          ${suspects.length ? `<h2>Top suspects</h2>
          <ol class="suspect-list">
            ${suspects.map(s => `
              <li>
                <div class="sus-who">${App.avatar(s, 44)}<div><b class="sus-name">${esc(s.name)}</b>
                  <span class="sus-detail">${esc(s.flags[0]?.detail || s.flags[0]?.rule || 'No rule flags, scored on other evidence')}${s.flags.length > 1 ? `, and ${s.flags.length - 1} more` : ''}</span></div></div>
                <span class="sus-score" style="color:${App.scoreColor(s)}">${s.score.toFixed(1)}</span>
                <span class="sus-actions">
                  <button class="btn secondary" data-card="${esc(s.id)}">Open card</button>
                  <button class="btn secondary" data-trace="${esc(s.id)}">Trace their day</button>
                </span>
              </li>`).join('')}
          </ol>` : ''}

          <h2>What stands out</h2>
          <ol class="findings">
            ${top.map(f => `
              <li class="finding" tabindex="0" data-t="${f.time_start}">
                <span class="text">${esc(App.shortText(f))}</span>
                <span class="when">${App.fmt(f.time_start)} to ${App.fmt(f.time_end)}, ${place(f.place)}</span>
              </li>`).join('')}
          </ol>

          <div class="cta">
            <button class="btn" id="play">Play the case</button>
            <button class="btn secondary" id="to-map">Open the map</button>
            <button class="btn secondary" id="to-network">See who met whom</button>
          </div>
        </section>`;

      el.querySelectorAll('.finding').forEach(c => {
        c.onclick = c.onkeydown = ev => {
          if (ev.type === 'keydown' && ev.key !== 'Enter') return;
          App.setState({ currentTime: +c.dataset.t, mode: 'map' });
        };
      });
      el.querySelectorAll('[data-card]').forEach(b => (b.onclick = () => App.selectStudent(b.dataset.card)));
      el.querySelectorAll('[data-trace]').forEach(b => (b.onclick = () => App.setState({ mode: 'trace', selectedStudent: b.dataset.trace })));
      el.querySelector('#play').onclick = () => App.setState({ storyStep: 0, mode: 'story' });
      el.querySelector('#to-map').onclick = () => App.setState({ mode: 'map' });
      el.querySelector('#to-network').onclick = () => App.setState({ mode: 'network' });
    }
  };
})();
