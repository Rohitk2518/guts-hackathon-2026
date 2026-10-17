/* story.js: "Play the case" (Som)
 * Steps through findings by rank, then a final mastermind reveal.
 * Each step glides the clock to the moment, zooms the map to the place and fades everyone
 * not involved. Arrow keys step too, so the presenter can drive it from the keyboard.
 */
(function () {
  const AUTO_MS = 7000;
  let el, data, steps, timer = null, narrate = false, onKey;

  const esc = App.esc;
  const place = App.placeName;
  const first = n => esc(n.split(' ')[0]);

  // final step: the kingpin's strongest link to a flagged student sets the time and place
  function revealStep() {
    const kp = App.byId[data.kingpin];
    if (!kp) return null;
    const links = data.edges.filter(e => (e.a === kp.id || e.b === kp.id))
      .map(e => ({ e, other: App.byId[e.a === kp.id ? e.b : e.a] })).filter(l => l.other && l.other.flagged)
      .sort((a, b) => b.e.weight - a.e.weight);
    const top = links[0];
    const stay = top && kp.stays.find(st => st.place === top.e.place);
    return {
      reveal: true, kp, links,
      time_start: stay ? stay.start : App.state.currentTime, place: top ? top.e.place : null,
      students: [kp.id, ...links.map(l => l.other.id)]
    };
  }

  function glideTo(t) {
    const from = App.state.currentTime ?? t;
    d3.transition('story-clock').duration(1100).tween('t', () => {
      const i = d3.interpolateRound(from, t);
      return k => App.setState({ currentTime: i(k) });
    });
  }

  function show(i) {
    i = Math.max(0, Math.min(steps.length - 1, i));
    const f = steps[i], last = i === steps.length - 1;
    App.setState({ storyStep: i });
    glideTo(f.reveal ? f.time_start : Views.map.busiest(f.students, f.time_start, f.time_end));
    Views.map.focus(f.place);
    Views.map.highlight(f.students);

    const who = f.students.map(id => App.byId[id]).filter(Boolean);
    const kpShown = f.reveal && App.state.revealMode;
    el.querySelector('#story-text').innerHTML = f.reveal ? `
        <div class="story-when">${App.fmt(f.time_start)}, ${place(f.place)}</div>
        ${kpShown
          ? `<h2 class="story-kp">${esc(f.kp.name)}</h2>
             <p>Never flagged by a single rule, yet met ${f.links.length} of the flagged students, more than anyone else.
             Clean on paper, connected to everyone.</p>`
          : `<h2>One person keeps turning up.</h2>
             <p>They broke no rules. Their testimony checks out. But look who they were with.</p>
             <button class="btn gold" id="story-reveal">Reveal the kingpin</button>`}` : `
        <div class="story-when">${App.fmt(f.time_start)} to ${App.fmt(f.time_end)}, ${place(f.place)}</div>
        <p class="story-finding${App.shortText(f).length > 160 ? ' long' : ''}">${esc(App.shortText(f))}</p>`;
    // flagged and mastermind first; cap the chips so a 19-person finding stays readable
    const shown = (f.reveal && !kpShown ? [] : who).sort((a, b) => (b.isKingpin && kpShown) - (a.isKingpin && kpShown) || b.flagged - a.flagged);
    el.querySelector('#story-who').innerHTML = shown.slice(0, 8).map(s =>
      `<button class="who-chip ${s.isKingpin && kpShown ? 'gold' : s.flagged ? 'flagged' : ''}" data-id="${esc(s.id)}">${first(s.name)}</button>`).join('') +
      (shown.length > 8 ? `<span class="muted">and ${shown.length - 8} more</span>` : '');

    el.querySelectorAll('.story-dot').forEach((d, j) => d.classList.toggle('on', j === i));
    el.querySelector('#story-prev').disabled = i === 0;
    el.querySelector('#story-next').disabled = last;
    el.querySelector('#story-count').textContent = `${i + 1} of ${steps.length}`;

    const rv = el.querySelector('#story-reveal');
    if (rv) rv.onclick = () => { App.setState({ revealMode: true }); show(i); };
    if (narrate && Views.speech) Views.speech.say(f.reveal ? (kpShown ? `The kingpin is ${f.kp.name}.` : 'One person keeps turning up.') : App.shortText(f));
    if (last) setAuto(false);
  }

  function setAuto(on) {
    clearInterval(timer); timer = null;
    if (on) timer = setInterval(() => show(App.state.storyStep + 1), AUTO_MS);
    const b = el && el.querySelector('#story-auto');
    if (b) b.textContent = on ? 'Pause' : 'Autoplay';
  }

  window.Views = window.Views || {};
  window.Views.story = {
    mount(container, d) {
      el = container; data = d;
      // untimed findings (the network one) are covered by the reveal step
      steps = data.findings.filter(f => f.time_start != null).sort((a, b) => a.rank - b.rank);
      const r = revealStep();
      if (r) steps.push(r);

      el.innerHTML = `
        <div class="story">
          <div class="story-map"></div>
          <aside class="story-panel">
            <div class="story-top">
              <span class="muted" id="story-count"></span>
              <div class="story-dots">${steps.map((s, i) => `<button class="story-dot${s.reveal ? ' kp' : ''}" data-i="${i}" aria-label="Step ${i + 1}"></button>`).join('')}</div>
            </div>
            <div id="story-text" class="story-text" aria-live="polite"></div>
            <div id="story-who" class="story-who"></div>
            <div class="story-nav">
              <button class="btn secondary" id="story-prev">Back</button>
              <button class="btn" id="story-next">Next</button>
              <button class="btn secondary" id="story-auto">Autoplay</button>
            </div>
            ${Views.speech ? '<label class="story-narrate"><input type="checkbox" id="story-narrate"> Read each step aloud</label>' : ''}
            <p class="muted story-hint">Arrow keys step through. Click a name to open their card.</p>
          </aside>
        </div>`;

      Views.map.mount(el.querySelector('.story-map'), data, { controls: false });
      el.querySelector('#story-prev').onclick = () => { setAuto(false); show(App.state.storyStep - 1); };
      el.querySelector('#story-next').onclick = () => { setAuto(false); show(App.state.storyStep + 1); };
      el.querySelector('#story-auto').onclick = () => setAuto(!timer);
      el.querySelector('.story-dots').onclick = e => { const i = e.target.dataset.i; if (i != null) { setAuto(false); show(+i); } };
      el.querySelector('#story-who').onclick = e => { const id = e.target.dataset.id; if (id) { setAuto(false); App.selectStudent(id); } };
      const n = el.querySelector('#story-narrate');
      if (n) { n.checked = narrate; n.onchange = () => (narrate = n.checked); }
      document.addEventListener('keydown', onKey = e => {
        if (document.querySelector('dialog[open]') || /INPUT|SELECT/.test(e.target.tagName)) return;
        if (e.key === 'ArrowRight') { setAuto(false); show(App.state.storyStep + 1); }
        if (e.key === 'ArrowLeft') { setAuto(false); show(App.state.storyStep - 1); }
      });
      show(App.state.storyStep || 0);
    },
    update(state) { Views.map.update(state); },
    unmount() {
      setAuto(false);
      d3.select(document.documentElement).interrupt('story-clock');   // d3.transition() runs on <html>
      document.removeEventListener('keydown', onKey);
      Views.speech?.stop();
      Views.map.unmount();
      el = null;
    }
  };
})();
