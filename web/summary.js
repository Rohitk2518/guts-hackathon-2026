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

      el.innerHTML = `
        <section class="brief">
          <h1>Someone planned to burn down the Boyd Orr.</h1>
          <p class="lead">
            We checked <b>${data.students.length} students</b> against ${swipes} building log entries and their own statements.
            <b class="sus">${flagged} stories don't hold up.</b>
            One person organised it, and on paper they look clean. Their name is <span class="redacted">hidden</span>.
          </p>

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
      el.querySelector('#play').onclick = () => App.setState({ storyStep: 0, mode: 'story' });
      el.querySelector('#to-map').onclick = () => App.setState({ mode: 'map' });
      el.querySelector('#to-network').onclick = () => App.setState({ mode: 'network' });
    }
  };
})();
