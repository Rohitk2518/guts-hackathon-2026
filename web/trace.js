/* trace.js: "Trace their day" for one student (Som)
 * Opened from the card. Plays the student's whole day continuously on the map: everyone else
 * fades, their trail grows, and the panel shows at each moment what the logs say, what they
 * claimed, who was with them, and what other students said about them. Ends on a verdict
 * built from the data (flags, contradictions, links to flagged students, LLM reasoning).
 */
(function () {
  const PLAY_MS = 24000, TICK = 40, GAP_BOOST = 5;   // whole day in ~24 s; gaps between stays play 5x faster
  let el, data, s, cmp, said, met, timer = null, T, t0, t1, step, lastStop;

  const esc = App.esc;
  const place = App.placeName;
  const first = n => esc(n.split(' ')[0]);
  const reRaw = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const covers = (x, t) => x.start != null && [t, t - 1440, t + 1440].some(u => u >= x.start && u < x.end);

  // sentences in other students' statements that name this student (first name only if it is unique)
  function mentions() {
    const fn = s.name.split(' ')[0];
    const uniqueFirst = data.students.filter(o => o.name.split(' ')[0] === fn).length === 1;
    const re = new RegExp(`\\b(${reRaw(s.name)}${uniqueFirst ? '|' + reRaw(fn) : ''})\\b`, 'i');
    return data.students.filter(o => o.id !== s.id && o.testimony).flatMap(o =>
      o.testimony.split(/(?<=[.!?])\s+/).filter(x => re.test(x)).map(text => ({ by: o, text })));
  }

  function company(stay, t) {
    return data.students.filter(o => o.id !== s.id && o.stays.some(st => st.place === stay.place && covers(st, t)));
  }

  function verdict() {
    const bad = cmp.claims.filter(c => c.bad).length, left = cmp.stays.filter(x => x.bad).length;
    const head = s.isKingpin && App.state.revealMode ? 'The mastermind'
      : s.score >= 7 ? 'Prime suspect' : s.flagged ? 'Suspect'
      : met.length >= 3 ? 'Clean on paper, but well connected' : 'Probably not involved';
    const why = [
      s.flags.length ? `Broke ${s.flags.length} rule${s.flags.length > 1 ? 's' : ''}: ${s.flags.map(f => esc(f.detail || f.rule)).join('; ')}.`
                     : 'Their logged movements break no rules.',
      !s.testimony ? 'They gave no statement.'
        : bad ? `${bad} of ${cmp.claims.length} things they said don't match the logs.` : 'What they said matches the logs.',
      left ? `${left} logged visit${left > 1 ? 's' : ''} missing from their statement.` : '',
      met.length ? `Spent time with ${met.length} flagged student${met.length > 1 ? 's' : ''}: ${met.slice(0, 6).map(o => esc(o.name)).join(', ')}${met.length > 6 ? '…' : ''}.` : 'Never with a flagged student.',
      said.length ? `Mentioned ${said.length} time${said.length > 1 ? 's' : ''} in other students' statements.` : '',
      s.llm_reasoning ? `<span class="muted">Analysis:</span> ${esc(s.llm_reasoning)}` : ''
    ].filter(Boolean);
    const tone = head === 'The mastermind' ? 'gold' : s.flagged ? 'alert' : '';
    return `<h3>Verdict</h3><div class="verdict-head ${tone}">${head}</div><ul class="verdict">${why.map(w => `<li>${w}</li>`).join('')}</ul>`;
  }

  function renderNow() {
    const stays = cmp.stays, i = stays.findIndex(x => covers(x, T));
    App.setState({ currentTime: ((Math.round(T) % 1440) + 1440) % 1440 });
    el.querySelector('#tr-clock').textContent = App.fmt(T);
    if (i === lastStop) return;   // panel only changes when they arrive somewhere new
    lastStop = i;

    const st = stays[i], now = el.querySelector('#tr-now');
    const with_ = st ? company(st, T) : [];
    Views.map.highlight([s.id, ...with_.map(o => o.id)]);
    Views.map.focus(st ? st.place : null);   // follow them; zoom out while they are between places
    if (!st) {
      now.innerHTML = '<p class="muted">Between buildings or off campus.</p>';
    } else {
      const claim = cmp.claims.find(c => c.place === st.place && covers(c, T)) || cmp.claims.find(c => covers(c, T));
      now.innerHTML = `
        <div class="story-when">${App.fmt(st.start)} to ${App.fmt(st.end)}, ${place(st.place)}</div>
        <dl class="tr-facts">
          <dt>Logs</dt><dd>${place(st.place)}</dd>
          <dt>They said</dt><dd class="${claim && claim.bad ? 'bad' : ''}">${claim ? `${place(claim.place)}${claim.activity ? ', ' + esc(claim.activity) : ''}${claim.bad ? ` <em>${claim.bad}</em>` : ''}` : st.bad ? '<span class="bad">Nothing. Left out of their statement.</span>' : '<span class="muted">No claim for this time.</span>'}</dd>
          <dt>With them</dt><dd>${with_.length ? with_.slice(0, 8).map(o => `<button class="who-chip ${o.flagged ? 'flagged' : ''}" data-id="${esc(o.id)}">${first(o.name)}</button>`).join(' ') + (with_.length > 8 ? ` <span class="muted">and ${with_.length - 8} more</span>` : '') : '<span class="muted">Alone</span>'}</dd>
        </dl>`;
    }
    el.querySelectorAll('#tr-stops li').forEach((li, j) => {
      li.classList.toggle('now', j === i);
      li.classList.toggle('past', stays[j].end <= T);
    });
  }

  function tick() {
    const inStay = cmp.stays.some(x => covers(x, T));
    T += step * (inStay ? 1 : GAP_BOOST);
    if (T >= t1) { T = t1; renderNow(); return finish(); }
    renderNow();
  }

  function play(on) {
    clearInterval(timer); timer = null;
    if (on) { if (T >= t1) restart(); timer = setInterval(tick, TICK); }
    const b = el && el.querySelector('#tr-play');
    if (b) b.textContent = on ? 'Pause' : 'Play';
  }

  function restart() { T = t0; lastStop = undefined; el.querySelector('#tr-verdict').hidden = true; renderNow(); }
  function finish() { play(false); const v = el.querySelector('#tr-verdict'); v.innerHTML = verdict(); v.hidden = false; v.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

  window.Views = window.Views || {};
  window.Views.trace = {
    mount(container, d) {
      el = container; data = d; s = App.byId[App.state.selectedStudent];
      if (!s) { el.innerHTML = '<div class="placeholder"><h2>Pick someone to trace</h2><p>Open a student\'s card and choose Trace their day.</p></div>'; return; }
      cmp = Views.card.compare(s);
      said = mentions();
      const flaggedIds = new Set(data.students.filter(o => o.flagged && o.id !== s.id).map(o => o.id));
      met = [...new Set(data.edges.filter(e => e.a === s.id || e.b === s.id).map(e => (e.a === s.id ? e.b : e.a)))]
        .filter(id => flaggedIds.has(id)).map(id => App.byId[id]);

      // playback window: a little before the first stay to a little after the last
      t0 = Math.max(0, (cmp.stays[0]?.start ?? 480) - 15);
      t1 = (cmp.stays.length ? Math.max(...cmp.stays.map(x => x.end)) : 1200) + 10;
      const weighted = cmp.stays.reduce((n, x) => n + (x.end - x.start), 0);
      const span = t1 - t0, effective = weighted + (span - weighted) / GAP_BOOST;
      step = effective / (PLAY_MS / TICK);

      el.innerHTML = `
        <div class="story">
          <div class="story-map"></div>
          <aside class="story-panel trace-panel">
            <div class="tr-head">
              <div><h2>${esc(s.name)}</h2><div class="muted">${esc([s.subject, s.flagged ? 'score ' + s.score.toFixed(1) : 'not flagged'].filter(Boolean).join(', '))}</div></div>
              <div class="tr-clock" id="tr-clock"></div>
            </div>
            <div id="tr-now" class="tr-now" aria-live="polite"></div>
            <div class="story-nav">
              <button class="btn" id="tr-play">Pause</button>
              <button class="btn secondary" id="tr-restart">Restart</button>
              <button class="btn secondary" id="tr-skip">Skip to verdict</button>
            </div>
            <section><h3>Their day</h3><ol class="route" id="tr-stops">${cmp.stays.map(x =>
              `<li class="${x.bad ? 'bad' : ''}"><time>${App.fmt(x.start)}</time><span>${place(x.place)}${x.bad ? ' <em>not in statement</em>' : ''}</span></li>`).join('') || '<li class="muted">No log entries.</li>'}</ol></section>
            <section><h3>What others said about them</h3>${said.length
              ? `<ul class="tr-said">${said.map(q => `<li><q>${esc(q.text)}</q> <button class="who-chip" data-id="${esc(q.by.id)}">${first(q.by.name)}</button></li>`).join('')}</ul>`
              : '<p class="muted">Nobody else mentioned them.</p>'}</section>
            <section id="tr-verdict" class="tr-verdict" hidden></section>
            <button class="btn secondary" id="tr-card">Back to their card</button>
          </aside>
        </div>`;

      Views.map.mount(el.querySelector('.story-map'), data, { controls: false });
      el.querySelector('#tr-play').onclick = () => play(!timer);
      el.querySelector('#tr-restart').onclick = () => { restart(); play(true); };
      el.querySelector('#tr-skip').onclick = () => { T = t1; renderNow(); finish(); };
      el.querySelector('#tr-card').onclick = () => Views.card.open(s.id);
      el.querySelector('.trace-panel').addEventListener('click', e => {
        const id = e.target.dataset.id;
        if (id) { play(false); Views.card.open(id); }
      });
      restart();
      play(true);
    },
    update(state) { Views.map.update(state); },
    unmount() { play(false); Views.map.unmount(); el = null; }
  };

  // self-check: wrap-around cover and unique-first-name mention matching
  console.assert(covers({ start: 1341, end: 1587 }, 60) && !covers({ start: 100, end: 200 }, 300), 'trace covers');
})();
