/* card.js: interrogation card (Som)
 * Opens on App.selectStudent(id). Shows what the student said next to what the logs say,
 * with contradictions in red, then flags and the LLM reasoning.
 * On open it jumps the clock to the first contradiction and, on the map, zooms there.
 */
(function () {
  const esc = App.esc;
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  const place = App.placeName;
  const span = x => x.start == null ? 'Time not given' : `${x.approx ? 'about ' : ''}${App.fmt(x.start)} to ${App.fmt(x.end)}`;

  // a claim is contradicted when logs at that place cover under half its time;
  // a stay is unmentioned when no claim covers it
  function compare(s) {
    const claims = s.claims.map(c => {
      const len = c.end - c.start;
      const got = s.stays.filter(st => st.place === c.place)
        .reduce((n, st) => n + Math.max(0, Math.min(st.end, c.end) - Math.max(st.start, c.start)), 0);
      const why = got === 0 ? 'No log entry backs this up' : `Logs cover only ${got} of ${len} min`;
      return { ...c, bad: got < len / 2 && why };
    });
    const stays = s.stays.slice().sort((a, b) => a.start - b.start)
      .map(st => ({ ...st, bad: s.claims.length > 0 && !s.claims.some(c => c.place === st.place && overlaps(st, c)) }));
    return { claims, stays };
  }

  // native <dialog>: Esc, focus trap and backdrop for free
  const d = document.body.appendChild(Object.assign(document.createElement('dialog'), { className: 'icard' }));
  d.onclose = () => window.Views.speech?.stop?.();

  window.Views = window.Views || {};
  window.Views.card = {
    compare,   // trace.js reuses the claim-vs-log check
    open(id) {
      const s = App.byId[id];
      if (!s) return;
      const { claims, stays } = compare(s);
      const sev = App.sev;
      const sub = [s.subject, s.year && 'year ' + s.year].filter(Boolean).join(', ');

      d.innerHTML = `<div class="icard-in">
        <header class="icard-head">
          <div>
            <h2>${esc(s.name)}</h2>
            <div class="muted">${esc(sub)}${sub ? ', ' : ''}ID ${esc(s.id)}</div>
          </div>
          <div class="icard-score ${s.flagged ? 'alert' : ''}"><b>${s.score.toFixed(1)}</b><span>suspicion</span></div>
          <div class="icard-actions">
            ${window.Views.speech ? '<button class="btn secondary" data-act="speak">Read aloud</button>' : ''}
            <button class="icard-x" data-act="close" aria-label="Close">&times;</button>
          </div>
        </header>
        <div class="icard-chips">${s.flags.map(f => `<span class="chip ${sev(f)}">${esc(f.rule)}</span>`).join('') || '<span class="muted">No flags raised.</span>'}</div>

        <div class="icard-cols">
          <section>
            <h3>What they said</h3>
            ${s.testimony ? `<blockquote>${esc(s.testimony)}</blockquote>` : '<p class="muted">No statement on file.</p>'}
            <ul class="icard-list">
              ${claims.map(c => `<li class="${c.bad ? 'bad' : ''}"><time>${span(c)}</time><span>${place(c.place)}${c.activity ? ', ' + esc(c.activity) : ''}${c.bad ? `<em>${c.bad}</em>` : ''}</span></li>`).join('')}
            </ul>
          </section>
          <section>
            <h3>What the logs say</h3>
            <ul class="icard-list">
              ${stays.map(st => `<li class="${st.bad ? 'bad' : ''}"><time>${span(st)}</time><span>${place(st.place)}${st.bad ? '<em>Not mentioned in their statement</em>' : ''}</span></li>`).join('') || '<li class="muted">No log entries.</li>'}
            </ul>
          </section>
        </div>

        ${s.flags.length ? `<section class="icard-flags"><h3>Why they were flagged</h3><ul>${s.flags.map(f => `<li><span class="chip ${sev(f)}">${esc(f.rule)}</span>${esc(f.detail || '')}</li>`).join('')}</ul></section>` : ''}
        ${s.llm_reasoning ? `<section class="icard-ai"><h3>Analysis</h3><p>${esc(s.llm_reasoning)}</p></section>` : ''}
        <footer class="icard-foot">
          <button class="btn secondary" data-act="map">Show on the map</button>
          <button class="btn" data-act="trace">Trace their day</button>
        </footer></div>`;

      // first contradiction: an unbacked claim, else an unmentioned stay, else a timed flag
      const first = claims.find(c => c.bad) || stays.find(st => st.bad) || s.flags.find(f => f.start != null);
      const goMap = () => {
        d.close();
        App.setState({ mode: 'map', currentTime: first ? first.start : App.state.currentTime });
        if (first && first.place) Views.map.focus(first.place);
      };
      d.onclick = e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (e.target === d || act === 'close') d.close();   // backdrop click or the x
        if (act === 'map') goMap();
        if (act === 'trace') { d.close(); App.setState({ mode: 'trace', selectedStudent: s.id }); }
        if (act === 'speak') Views.speech.speak(s);
      };

      if (!d.open) d.showModal();
      if (first) {
        App.setState({ currentTime: first.start });
        if (App.state.mode === 'map' && first.place) Views.map.focus(first.place);
      }
    }
  };

  // self-check: unbacked claim and unmentioned stay are both caught
  const r = compare({ claims: [{ place: 'lib', start: 100, end: 200 }], stays: [{ place: 'qmu', start: 100, end: 200 }] });
  console.assert(r.claims[0].bad && r.stays[0].bad, 'card compare');
  const p = compare({ claims: [{ place: 'b', start: 600, end: 720 }], stays: [{ place: 'b', start: 600, end: 630 }] });
  console.assert(p.claims[0].bad === 'Logs cover only 30 of 120 min' && !p.stays[0].bad, 'card partial');
})();
