/* map.js: campus map on a real street basemap (Som)
 * campus.jpg = Esri World Street Map tiles, zoom 17, x 63972-63978, y 40896-40900, stitched once
 * so the demo works offline. Buildings use the same Web Mercator maths so they sit on their outlines.
 *
 * Students are person icons coloured by suspicion. At state.currentTime each one is in the building
 * they are logged in, or walking between two buildings when the gap is short.
 * Extras: moment chips (from findings), speed, names toggle, testimony ghosts (where they said they
 * were, when the logs disagree), trail for the selected student, live side panel.
 *
 * Views.map.mount(el, data, { controls:false }) lets story.js embed the bare map.
 * Views.map.focus(placeId | null) zooms; Views.map.highlight(ids | null) fades everyone else.
 */
(function () {
  const Z = 17, X0 = 63972, Y0 = 40896, IMG_W = 1792, IMG_H = 1280;
  const PAD = 110, ZOOM = 2.2;
  const WALK_MAX = 30;   // ponytail: gaps longer than this hide the person (left campus); tune if real data looks sparse
  // label side per building where the default (below) collides; tune by eye
  const LABEL = { boyd_orr_building: 'left', sir_alwyn_williams_building: 'above', adam_smith_building: 'above', the_hive: 'above', kelvin_building: 'right', glasgow_university_union: 'right', kelvingrove_park: 'far' };
  const LABEL_AT = { far: [-54, 5, 'end'], below: [0, 32, 'middle'], above: [0, -36, 'middle'], left: [-20, 5, 'end'], right: [20, 5, 'start'] };
  const MAX_SHOWN = 9;   // avatars drawn per building; the rest fold into a "+N" badge
  const R = s => (s.score > 0 || s.flagged ? 19 : 15);   // avatar radius; suspects a bit bigger

  let svg, data, pos = {}, stays = {}, timer = null, highlightIds = null, base, el, opts = {};
  let crowdAt = {}, placeOf = {};   // from the last render: place -> students there, student -> place
  let showClaims = true, speed = 2, activeMoment = null;
  let zk = 1;   // marker scale: shrinks a little when the map zooms in so avatars don't balloon
  let zoom, layer;   // d3.zoom moves layer; wheel/drag/pinch, the +/- buttons and focus() all go through it

  const place = App.placeName;
  const colour = s => App.scoreColor(s);

  // lat/lng -> pixel on campus.jpg (Web Mercator, same as the tiles)
  function merc(lat, lng) {
    const n = 256 * 2 ** Z, r = lat * Math.PI / 180;
    return [(lng + 180) / 360 * n - X0 * 256, (1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n - Y0 * 256];
  }

  function isOpen(b, t) {
    if (b.isOutdoor || b.opens === b.closes) return true;
    return b.opens < b.closes ? t >= b.opens && t < b.closes : t >= b.opens || t < b.closes; // wraps past midnight
  }

  // where is student s at minute t? also checks t+1440 for stays that run past midnight
  function where(s, t) {
    const st = stays[s.id];
    for (const tt of [t, t + 1440]) {
      for (let i = 0; i < st.length; i++) {
        if (tt >= st[i].start && tt < st[i].end) return { place: st[i].place };
        const n = st[i + 1];
        if (n && tt >= st[i].end && tt < n.start && n.start - st[i].end <= WALK_MAX)
          return { from: st[i].place, to: n.place, f: (tt - st[i].end) / (n.start - st[i].end) };
      }
    }
    return null;
  }

  const covers = (x, t) => x.start != null && ((t >= x.start && t < x.end) || (t + 1440 >= x.start && t + 1440 < x.end));

  function hours(b) {
    if (b.isOutdoor || b.opens === b.closes) return 'Open all day';
    return App.fmt(b.opens) + ' to ' + App.fmt(b.closes);
  }

  function draw(wrap) {
    data.buildings.forEach(b => (pos[b.id] = merc(b.lat, b.lng)));
    const xs = Object.values(pos).map(p => p[0]), ys = Object.values(pos).map(p => p[1]);
    const x0 = Math.max(0, d3.min(xs) - PAD), y0 = Math.max(0, d3.min(ys) - PAD);
    base = [x0, y0, Math.min(IMG_W, d3.max(xs) + PAD) - x0, Math.min(IMG_H, d3.max(ys) + PAD) - y0];

    svg = d3.select(wrap).append('svg').attr('class', 'campus').attr('viewBox', base.join(' '))
      .style('aspect-ratio', `${base[2]} / ${base[3]}`)
      .attr('role', 'img').attr('aria-label', 'Campus map of student locations');
    // circular crop for the avatar images (objectBoundingBox = works at any size)
    svg.append('defs').html('<clipPath id="av-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>');
    layer = svg.append('g');
    zoom = d3.zoom().scaleExtent([1, 6]).translateExtent([[base[0], base[1]], [base[0] + base[2], base[1] + base[3]]])
      .on('zoom', ev => {
        layer.attr('transform', ev.transform);
        zk = 1 / Math.sqrt(ev.transform.k);   // avatars and labels grow slower than the map
        layer.selectAll('.bld-mark').attr('transform', b => `translate(${pos[b.id]}) scale(${zk})`);
        layer.selectAll('.bld-label').attr('transform', labelAt);
        if (data) render(App.state);
      });
    svg.call(zoom);
    layer.append('image').attr('class', 'basemap').attr('href', 'campus.jpg').attr('width', IMG_W).attr('height', IMG_H);
    layer.append('rect').attr('class', 'map-shade').attr('width', IMG_W).attr('height', IMG_H);

    // 200 m scale bar: lets viewers judge walking distances (5 km/h is about 80 m a minute)
    const perMetre = 256 * 2 ** Z / (40075016.686 * Math.cos(d3.mean(data.buildings, b => b.lat) * Math.PI / 180));
    const len = 200 * perMetre;
    const sb = layer.append('g').attr('class', 'scale').attr('transform', `translate(${base[0] + 36},${base[1] + base[3] - 30})`);
    sb.append('path').attr('d', `M0,-6V0H${len}V-6`);
    sb.append('text').attr('x', len + 10).text('200 m, about 2.5 min walk');

    const bg = layer.append('g').selectAll('g').data(data.buildings).join('g')
      .attr('class', b => 'bld bld-mark' + (b.isOutdoor ? ' outdoor' : ''))
      .attr('transform', b => `translate(${pos[b.id]}) scale(${zk})`);
    bg.append('rect').attr('x', -11).attr('y', -11).attr('width', 22).attr('height', 22).attr('rx', 5);
    bg.append('title').text(b => b.name + ': ' + hours(b));

    layer.append('g').attr('class', 'trail-layer');
    layer.append('g').attr('class', 'ghost-layer');

    layer.append('g').attr('class', 'markers').selectAll('g').data(data.students, s => s.id).join('g')
      .attr('class', 'mk').attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', s => 'Open card for ' + s.name)
      .on('click', (ev, s) => {   // a crowd opens the who's-here picker; someone on their own opens directly
        const p = placeOf[s.id], crowd = p && crowdAt[p];
        if (crowd && crowd.length > 1) showPicker(ev, p, crowd); else App.selectStudent(s.id);
      })
      .on('keydown', (ev, s) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); App.selectStudent(s.id); } })
      .each(function (s) {
        // avatar: generated toon head (hair in the student's colour), ring in the suspicion colour
        const r = R(s), g = d3.select(this).append('g').attr('class', 'mk-in').attr('transform', `scale(${zk})`);
        g.append('circle').attr('class', 'hit').attr('r', r + 3);
        if (s.flagged) g.append('circle').attr('class', 'ring pulse').attr('r', r).attr('stroke', colour(s));
        g.append('circle').attr('class', 'av-bg').attr('r', r).attr('stroke', colour(s));
        g.append('image').attr('href', `avatars/${s.id}.svg`).attr('x', -r).attr('y', -r).attr('width', 2 * r).attr('height', 2 * r)
          .attr('clip-path', 'url(#av-clip)');
        g.append('text').attr('class', 'mk-name').attr('y', r + 15).text(s.name.split(' ')[0]);
        d3.select(this).append('title').text(s.name + (s.score > 0 ? ', score ' + s.score.toFixed(1) : ''));
      });

    layer.append('g').attr('class', 'badges');

    // labels last so crowds never cover them; class bld so open/closed styling still applies
    layer.append('g').attr('class', 'labels').selectAll('g').data(data.buildings).join('g')
      .attr('class', 'bld bld-label')
      .attr('transform', labelAt)
      .attr('text-anchor', b => LABEL_AT[LABEL[b.id] || 'below'][2])
      .call(g => g.append('text').attr('class', 'bld-name').text(b => b.name))
      .call(g => g.append('text').attr('class', 'bld-hours').attr('y', 17).text(hours));
  }

  function labelAt(b) {
    const [x, y] = LABEL_AT[LABEL[b.id] || 'below'];
    return `translate(${pos[b.id][0] + x * zk},${pos[b.id][1] + y * zk}) scale(${zk})`;
  }

  function render(state) {
    if (!svg) return;
    const t = state.currentTime ?? 480, sel = state.selectedStudent;
    svg.classed('night', App.isNight(t)).classed('reveal', state.revealMode);
    svg.selectAll('.bld').classed('closed', b => !isOpen(b, t));

    // who is where; at = place -> everyone there (the picker lists all of them)
    const wh = {}, at = {}, xy = {};
    data.students.forEach(s => {
      const w = where(s, t);
      if (!w || !pos[w.place || w.from] || (w.to && !pos[w.to])) return;   // off campus
      wh[s.id] = w;
      if (w.place) (at[w.place] = at[w.place] || []).push(s);
    });
    // draw the most relevant MAX_SHOWN per building: selected, highlighted, mastermind after reveal, then by score
    const prio = s => (s.id === sel) * 1e4 + (highlightIds?.includes(s.id) ? 5e3 : 0) + (state.revealMode && s.isKingpin) * 4e3 + s.score * 10 + s.flagged * 50;
    const slot = {}, extra = {};
    Object.entries(at).forEach(([p, ss]) => {
      ss.sort((a, b) => prio(b) - prio(a)).slice(0, MAX_SHOWN).forEach((s, i) => (slot[s.id] = i));
      if (ss.length > MAX_SHOWN) extra[p] = ss;
    });
    svg.selectAll('.mk').each(function (s) {
      const w = wh[s.id], g = d3.select(this);
      if (!w || (w.place && slot[s.id] == null)) return g.attr('display', 'none');
      let x, y;
      if (w.place) {
        const i = slot[s.id], a = i * 2.4, r = (i ? 32 + 13 * Math.sqrt(i) : 30) * zk;
        [x, y] = pos[w.place];
        x += r * Math.cos(a); y += r * Math.sin(a);
      } else {
        const [ax, ay] = pos[w.from] || [0, 0], [bx, by] = pos[w.to] || [0, 0];
        x = ax + (bx - ax) * w.f; y = ay + (by - ay) * w.f;
      }
      xy[s.id] = [x, y];
      const gold = state.revealMode && s.isKingpin;
      g.attr('display', null).attr('transform', `translate(${x},${y})`)
        .attr('class', 'mk' + (s.flagged ? ' flagged' : ' clean') + (s.isKingpin ? ' kingpin' : '') + (sel === s.id ? ' selected' : '') +
          ((highlightIds && !highlightIds.includes(s.id)) || (state.revealMode && !s.flagged && !s.isKingpin) ? ' dim' : ''));
      g.select('.av-bg').attr('stroke', gold ? 'var(--gold)' : colour(s));
      g.select('.mk-in').attr('transform', `scale(${zk * (sel === s.id ? 1.8 : 1)})`);   // the selected / traced person stands out
    });

    // "+N" badge for everyone not drawn at a crowded building; opens the who's-here picker
    const bd = svg.select('.badges').selectAll('g.badge').data(Object.entries(extra), d => d[0]).join(enter => {
      const e = enter.append('g').attr('class', 'badge').attr('role', 'button').attr('tabindex', 0);
      e.append('circle').attr('r', 15);
      e.append('text');
      return e;
    });
    bd.attr('transform', ([p]) => `translate(${pos[p][0] + 30 * zk},${pos[p][1] - 30 * zk}) scale(${zk})`)
      .on('click', (ev, [p, ss]) => showPicker(ev, p, ss))
      .on('keydown', (ev, [p, ss]) => { if (ev.key === 'Enter') showPicker(ev, p, ss); });
    bd.select('text').text(([, ss]) => '+' + (ss.length - MAX_SHOWN));

    drawTrail(sel, t, xy);
    drawGhosts(t, sel);
    crowdAt = at;
    placeOf = Object.fromEntries(Object.entries(at).flatMap(([p, ss]) => ss.map(s => [s.id, p])));
    renderSide(state, t, at, wh);   // wh: everyone on campus, drawn or folded into a badge
  }

  // dashed numbered route through the selected student's stays up to now
  function drawTrail(id, t, xy) {
    const layer = svg.select('.trail-layer').html('');
    if (!id || !stays[id]) return;
    const pts = stays[id].filter(st => st.start <= t && pos[st.place]).map(st => pos[st.place]);
    if (xy[id]) pts.push(xy[id]);
    if (pts.length < 2) return;
    layer.append('path').attr('class', 'trail').attr('d', d3.line()(pts));
    pts.slice(0, -1).forEach((p, i) => {
      layer.append('circle').attr('class', 'trail-stop').attr('cx', p[0]).attr('cy', p[1]).attr('r', 12);
      layer.append('text').attr('class', 'trail-n').attr('x', p[0]).attr('y', p[1]).text(i + 1);
    });
  }

  // dashed ring where a flagged (or selected) student says they were, when the logs put them elsewhere
  function drawGhosts(t, sel) {
    const list = !showClaims ? [] : data.students.filter(s => s.flagged || s.id === sel).flatMap(s => {
      const c = s.claims.find(c => covers(c, t) && pos[c.place]);
      const w = c && where(s, t);
      return c && (!w || w.place !== c.place) ? [{ s, c }] : [];
    });
    const g = svg.select('.ghost-layer').selectAll('g.ghost').data(list, d => d.s.id).join(enter => {
      const e = enter.append('g').attr('class', 'ghost');
      e.append('circle').attr('r', 20);
      e.append('text').attr('y', -28);
      return e;
    });
    g.attr('transform', (d, i) => { const [x, y] = pos[d.c.place]; return `translate(${x - 40 - 18 * i},${y - 34})`; });
    g.select('circle').attr('stroke', d => colour(d.s));
    g.select('text').attr('fill', d => colour(d.s)).text(d => d.s.name.split(' ')[0] + ' says here');
  }

  // list everyone at one building so the right person can be picked out of a crowd
  function showPicker(ev, p, crowd) {
    const wrap = svg.node().parentNode, box = wrap.getBoundingClientRect();
    wrap.querySelector('.picker')?.remove();
    const people = crowd.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const pk = document.createElement('div');
    pk.className = 'picker';
    pk.innerHTML = `<div class="picker-head">${people.length} people at ${place(p)}</div>
      <ul>${people.map(s => `<li><button data-id="${App.esc(s.id)}">${App.avatar(s, 26)}${App.esc(s.name)}${s.score > 0 ? `<b>${s.score.toFixed(1)}</b>` : ''}</button></li>`).join('')}</ul>`;
    wrap.appendChild(pk);
    // open next to the click, kept inside the map
    pk.style.left = Math.min(ev.clientX - box.left + 10, box.width - pk.offsetWidth - 8) + 'px';
    pk.style.top = Math.max(8, Math.min(ev.clientY - box.top - 20, box.height - pk.offsetHeight - 8)) + 'px';
    pk.querySelector('button').focus();
    const close = () => { pk.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = e => { if (!pk.contains(e.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    pk.onkeydown = e => { if (e.key === 'Escape') close(); };
    pk.onclick = e => { const id = e.target.closest('button')?.dataset.id; if (id) { close(); App.selectStudent(id); } };
  }

  function renderSide(state, t, at, xy) {
    if (!el || opts.controls === false) return;
    const q = s => el.querySelector(s);
    const flaggedAt = Object.entries(at).map(([p, ss]) => [p, ss.filter(s => s.flagged || (state.revealMode && s.isKingpin))]);
    const here = Object.keys(xy).length;
    // alerts: a flag whose time window covers now, or anyone inside a building after it closed
    const closedNow = Object.entries(at).filter(([p]) => App.placeById[p] && !isOpen(App.placeById[p], t));
    const alertIds = new Set([...data.students.filter(s => s.flags.some(f => covers(f, t))).map(s => s.id),
      ...closedNow.flatMap(([, ss]) => ss.map(s => s.id))]);
    const alerts = alertIds.size;
    q('#st-here').textContent = here;
    q('#st-alerts').textContent = alerts;
    q('#map-now').textContent = App.fmt(t);

    const kp = App.byId[data.kingpin];
    const kpBox = q('#st-kp');
    if (state.revealMode && kp) {
      const flagged = data.students.filter(s => s.flagged).map(s => s.id);
      const met = new Set(data.edges.filter(e => e.a === kp.id || e.b === kp.id).map(e => (e.a === kp.id ? e.b : e.a)).filter(id => flagged.includes(id)));
      kpBox.hidden = false;
      kpBox.querySelector('.stat-n').textContent = `${met.size} / ${flagged.length}`;
      kpBox.querySelector('.stat-l').textContent = `flagged students ${kp.name.split(' ')[0]} has met`;
    } else kpBox.hidden = true;

    const groups = flaggedAt.filter(([, ss]) => ss.length >= 2);
    const feed = [
      ...closedNow.map(([p, ss]) => `<li class="alert"><time>${App.fmt(t)}</time><span>${ss.length} inside ${place(p)} after it closed</span></li>`),
      ...groups.map(([p, ss]) => `<li><time>${App.fmt(t)}</time><span>${ss.map(s => App.esc(s.name.split(' ')[0])).join(', ')} together at ${place(p)}</span></li>`)
    ];
    q('#map-feed').innerHTML = feed.join('') || '<li class="empty">Nothing unusual right now.</li>';

    const s = App.byId[state.selectedStudent];
    const who = q('#map-who');
    who.hidden = !s;
    if (s) {
      const route = stays[s.id];
      who.innerHTML = `
        <div class="who-name">${App.esc(s.name)}</div>
        <div class="who-sub">${App.esc([s.subject, s.flagged ? 'score ' + s.score.toFixed(1) : 'not flagged'].filter(Boolean).join(', '))}</div>
        <div>${s.flags.map(f => `<span class="chip ${App.sev(f)}">${App.esc(f.rule)}</span>`).join('')}</div>
        <ol class="route">${route.map(st => `<li class="${covers(st, t) ? 'now' : st.end <= t ? 'past' : ''}"><time>${App.fmt(st.start)}</time><span>${place(st.place)}</span></li>`).join('')}</ol>`;
    }

    // suspects list: open a card without hunting for them on the map; shows where each one is now
    const list = App.rankSuspects().slice();
    if (state.revealMode && App.byId[data.kingpin]) list.unshift(App.byId[data.kingpin]);
    q('#map-suspects').innerHTML = list.map(s => `<li><button data-id="${App.esc(s.id)}" class="${state.selectedStudent === s.id ? 'on' : ''}">
        ${App.avatar(s, 30)}
        <span>${App.esc(s.name)}<small>${placeOf[s.id] ? place(placeOf[s.id]) : 'not on campus now'}</small></span>
        <b>${s.isKingpin ? 'mastermind' : s.score.toFixed(1)}</b></button></li>`).join('') || '<li class="empty">No one has a suspicion score yet.</li>';
  }

  function setPlaying(on) {
    clearInterval(timer); timer = null;
    const btn = el && el.querySelector('#map-play');
    if (on) {
      timer = setInterval(() => {
        const t = (App.state.currentTime ?? 0) + speed;
        if (t > 1439) return setPlaying(false);
        App.setState({ currentTime: t });
      }, 40);
    }
    if (btn) {
      btn.innerHTML = on
        ? '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>'
        : '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 4 2.5z"/></svg>';
      btn.setAttribute('aria-label', on ? 'Pause' : 'Play the day');
    }
  }

  window.Views = window.Views || {};
  window.Views.map = {
    mount(container, d, o = {}) {
      el = container; data = d; opts = o; pos = {}; highlightIds = null; activeMoment = null; zk = 1;
      data.students.forEach(s => (stays[s.id] = s.stays.slice().sort((a, b) => a.start - b.start)));
      const controls = o.controls !== false;
      // one chip per time + place; findings that share both merge their students
      const byKey = {};
      data.findings.filter(f => f.time_start != null).forEach(f => {
        const k = f.time_start + '|' + f.place;
        if (byKey[k]) byKey[k].students = [...new Set([...byKey[k].students, ...f.students])];
        else byKey[k] = { ...f, students: [...f.students] };
      });
      const moments = Object.values(byKey).sort((a, b) => a.time_start - b.time_start);

      el.innerHTML = !controls ? '<div class="map-wrap"></div>' : `
        <div class="map-layout">
          <div class="map-main">
            <div class="map-head">
              <h2>Campus map</h2>
              <button class="moment active" data-i="-1">Whole campus</button>
              ${moments.map((f, i) => `<button class="moment" data-i="${i}"><b>${App.fmt(f.time_start)}</b>${place(f.place)}</button>`).join('')}
            </div>
            <div class="map-wrap"></div>
            <div class="map-bar">
              <button class="icon-btn" id="map-play"></button>
              <select id="map-speed" aria-label="Playback speed">
                <option value="1">1×</option><option value="2" selected>2×</option><option value="5">5×</option><option value="10">10×</option>
              </select>
              <input type="range" id="map-time" class="map-time" min="0" max="1439" step="1" aria-label="Time of day">
              <span class="map-now" id="map-now"></span>
            </div>
          </div>
          <aside class="map-side">
            <div class="panel stats">
              <div class="stat"><div class="stat-n" id="st-here">0</div><div class="stat-l">on campus</div></div>
              <div class="stat"><div class="stat-n alert" id="st-alerts">0</div><div class="stat-l">alerts now</div></div>
              <div class="stat wide" id="st-kp" hidden><div class="stat-n gold"></div><div class="stat-l"></div></div>
            </div>
            <div class="panel"><h3>Suspects</h3><ul class="suspects" id="map-suspects"></ul></div>
            <div class="panel"><h3>Right now</h3><ul class="feed" id="map-feed"></ul></div>
            <div class="panel" id="map-who" hidden></div>
            <div class="panel opts">
              <label><input type="checkbox" id="opt-names"> Show suspect names</label>
              <label><input type="checkbox" id="opt-claims" checked> Show testimony claims</label>
            </div>
            <div class="panel legend">
              <span><i style="background:var(--alert)"></i>High suspicion</span>
              <span><i style="background:var(--warn)"></i>Medium</span>
              <span><i style="background:var(--low)"></i>Low</span>
              <span><i style="background:var(--clean)"></i>Not flagged</span>
              <span><i style="background:var(--gold)"></i>Mastermind, after the reveal</span>
              <span><i style="border:2px dashed var(--alert);background:none"></i>Where they say they were</span>
              <span><i style="background:var(--indoor);border-radius:2px"></i>Building open</span>
              <span><i style="border:1px dashed var(--clean);border-radius:2px;background:none"></i>Building closed</span>
            </div>
          </aside>
        </div>`;

      const wrap = el.querySelector('.map-wrap');
      draw(wrap);
      wrap.insertAdjacentHTML('beforeend', `<div class="net-controls map-zoom">
        <button class="icon-btn" data-z="1.5" aria-label="Zoom in">+</button>
        <button class="icon-btn" data-z="0.667" aria-label="Zoom out">&minus;</button>
        <button class="icon-btn" data-z="0" aria-label="Show whole campus"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg></button>
      </div>`);
      wrap.querySelector('.map-zoom').onclick = e => {
        const z = e.target.closest('button')?.dataset.z;
        if (z) svg.transition().duration(350).call(+z ? zoom.scaleBy : zoom.transform, +z || d3.zoomIdentity);
      };
      wrap.insertAdjacentHTML('beforeend', '<div class="map-credit">Basemap: Esri, HERE, Garmin, &copy; OpenStreetMap contributors. Avatars: ToonHead by Johan Melin, CC BY 4.0, via DiceBear</div>');
      // keep the map and its controls on one screen
      (el.querySelector('.map-main') || wrap).style.maxWidth = `calc((100vh - ${controls ? 250 : 200}px) * ${base[2] / base[3]})`;
      if (!controls) return;

      const range = el.querySelector('#map-time');
      range.oninput = () => App.setState({ currentTime: +range.value });
      el.querySelector('#map-play').onclick = () => setPlaying(!timer);
      el.querySelector('#map-speed').onchange = e => (speed = +e.target.value);
      el.querySelector('#map-suspects').onclick = e => { const id = e.target.closest('button')?.dataset.id; if (id) App.selectStudent(id); };
      el.querySelector('#opt-names').onchange = e => svg.classed('show-names', e.target.checked);
      el.querySelector('#opt-claims').onchange = e => { showClaims = e.target.checked; render(App.state); };
      el.querySelectorAll('.moment').forEach(b => (b.onclick = () => {
        const f = moments[+b.dataset.i];
        el.querySelectorAll('.moment').forEach(m => m.classList.toggle('active', m === b));
        setPlaying(false);
        this.focus(f ? f.place : null);
        highlightIds = f ? f.students : null;
        App.setState(f ? { currentTime: this.busiest(f.students, f.time_start, f.time_end) } : {});
      }));
      this._range = range;
      setPlaying(false);
    },
    update(state) {
      if (this._range) this._range.value = state.currentTime ?? 480;
      render(state);
    },
    unmount() { setPlaying(false); svg = null; el = null; this._range = null; },

    focus(placeId) {
      if (!svg) return;
      const p = placeId && pos[placeId];
      svg.transition().duration(900).call(zoom.transform, !p ? d3.zoomIdentity
        : d3.zoomIdentity.translate(base[0] + base[2] / 2, base[1] + base[3] / 2).scale(ZOOM).translate(-p[0], -p[1]));
    },
    highlight(ids) { highlightIds = ids; render(App.state); },
    // minute in [start, end] when most of ids are on campus; findings give the window's first minute
    busiest(ids, start, end) {
      if (end == null || ids.length < 2) return start;
      const len = (end - start + 1440) % 1440, here = t => ids.filter(id => App.byId[id] && where(App.byId[id], t)).length;
      let best = start;
      for (let m = 0; m <= len; m += 5) { const t = (start + m) % 1440; if (here(t) > here(best)) best = t; }
      return best;
    },

    _test: { isOpen, where, merc, covers }
  };

  // self-check: open hours that wrap past midnight, walking between stays, projection lands on the image
  const T = window.Views.map._test, lib = { opens: 420, closes: 120 };
  console.assert(T.isOpen(lib, 60) && T.isOpen(lib, 1400) && !T.isOpen(lib, 300), 'isOpen wrap');
  console.assert(T.isOpen({ opens: 0, closes: 0 }, 300), 'isOpen 0000-0000');
  stays.t = [{ place: 'a', start: 100, end: 200 }, { place: 'b', start: 220, end: 300 }];
  console.assert(T.where({ id: 't' }, 150).place === 'a' && T.where({ id: 't' }, 210).f === .5 && !T.where({ id: 't' }, 400), 'where');
  delete stays.t;
  console.assert(T.covers({ start: 1380, end: 1500 }, 30) && !T.covers({ start: 100, end: 200 }, 300), 'covers past midnight');
  const [bx, by] = T.merc(55.8735737, -4.2926741);   // Boyd Orr
  console.assert(bx > 0 && bx < IMG_W && by > 0 && by < IMG_H, 'merc on image');
})();
