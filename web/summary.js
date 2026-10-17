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
      // after the reveal the brief states the conclusion, with the same numbers as the story reveal
      const kc = App.kingpinCase(), kp = kc && kc.kp;
      // the brief's rule: the kingpin met every conspirator, so conspirators = flagged students the kingpin met.
      // Everyone else with a flag is still worth a look, as another irregularity in the data.
      const conspirators = kc ? kc.contacts.map(x => x.s) : [];
      const others = App.rankSuspects().filter(s => !conspirators.includes(s));
      const row = s => `
              <li>
                <div class="sus-who">${App.avatar(s, 44)}<div><b class="sus-name">${esc(s.name)}</b>
                  <span class="sus-detail">${esc(s.flags[0]?.detail || s.flags[0]?.rule || 'No rule flags, scored on other evidence')}${s.flags.length > 1 ? `, and ${s.flags.length - 1} more` : ''}</span></div></div>
                <span class="sus-score" style="color:${App.scoreColor(s)}">${s.score.toFixed(1)}</span>
                <span class="sus-actions">
                  <button class="btn secondary" data-card="${esc(s.id)}">Open card</button>
                  <button class="btn secondary" data-trace="${esc(s.id)}">Trace their day</button>
                </span>
              </li>`;

      el.innerHTML = `
        <div class="case-page">
        <section class="brief">
          <h1>Someone planned to burn down the Boyd Orr.</h1>
          <p class="lead">
            We checked <b>${data.students.length} students</b> against ${swipes} building log entries and their own statements.
            <b class="sus">${flagged} stories don't hold up.</b>
            ${kp && App.state.revealMode
              ? `The kingpin is <b class="kp">${esc(kp.name)}</b>. They broke no rules, yet spent a combined ${App.dur(kc.minutes)} with ${kc.contacts.length} of the ${kc.breakers} students who did${kc.contacts.length ? `: ${kc.contacts.map(x => esc(x.s.name)).join(', ')}` : ''}${kc.rank === 1 ? ', more than any other student' : ''}.`
              : `One person, the kingpin, organised it, and on paper they look clean. Their name is <span class="redacted" aria-label="hidden">Name withheld</span>.`}
          </p>

          ${conspirators.length ? `<h2>Likely conspirators</h2>
          <p class="list-note">Flagged students who all spent time with the same clean-looking student.</p>
          <ol class="suspect-list">${conspirators.map(row).join('')}</ol>` : ''}

          ${others.length ? `<h2>Other irregularities</h2>
          <p class="list-note">Flagged, but never with ${kp && App.state.revealMode ? esc(kp.name.split(' ')[0]) : 'the kingpin'}. Strange data worth a look.</p>
          <ul class="suspect-list others">${others.map(row).join('')}</ul>` : ''}

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
          <p class="method">Every view is drawn straight from the security logs, building data and statements, so the same dashboard works for any day's data.</p>
        </section>
        <figure class="exhibit">
          <img src="boyd-orr.jpg" alt="The Boyd Orr Building, University of Glasgow" width="768" height="1024">
          <figcaption><b>Exhibit A.</b> The Boyd Orr Building, the target.
            <small>Photo: Thomas Nugent, CC BY-SA 2.0, via Wikimedia Commons</small></figcaption>
        </figure>
        </div>`;

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
