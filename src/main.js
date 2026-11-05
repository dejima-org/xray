import { PROJECTS, KEYS, keyById, keyName, keyOpts, keyShown, defaults, normalise } from './config.js';
import { derive } from './topology.js';
import { scenarios } from './scenarios.js';
import { Stage } from './render.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const state = { cfg: load(), picked: null, scenario: null, step: 0, playing: false, speed: 1, run: 0, fit: true };
let derived, list = [];

const wrap = $('#stage-wrap'), sizer = $('#sizer'), world = $('#world');
const stage = new Stage(world, id => pick(id));

// ---- config persistence: the URL carries what differs from the defaults ---
function load() {
  const c = defaults();
  try {
    const diff = JSON.parse(decodeURIComponent(atob(location.hash.slice(1))));
    Object.assign(c.on, diff.on || {});
    for (const [k, v] of Object.entries(diff)) if (k !== 'on' && k in keyById) c[k] = v;
  } catch { /* no hash, or not ours */ }
  return normalise(c);
}
function save() {
  const d = defaults(), diff = { on: {} };
  for (const p of PROJECTS) if (state.cfg.on[p.id] !== d.on[p.id]) diff.on[p.id] = state.cfg.on[p.id];
  for (const k of KEYS) if (JSON.stringify(state.cfg[k.id]) !== JSON.stringify(d[k.id])) diff[k.id] = state.cfg[k.id];
  const empty = !Object.keys(diff.on).length && Object.keys(diff).length === 1;
  history.replaceState(null, '', empty ? location.pathname : '#' + btoa(encodeURIComponent(JSON.stringify(diff))));
}

// ---- the whole loop: config -> picture -> rail, scenarios, inspector -------
async function apply() {
  normalise(state.cfg);
  derived = derive(state.cfg);
  list = scenarios(state.cfg, derived);
  stopRun();
  const settled = stage.update(derived.root, derived.edges);
  if (state.fit) fit();
  renderRail();
  renderScenarios();
  renderInspector();
  save();
  await settled;
  if (state.scenario && list.some(s => s.id === state.scenario)) play(state.scenario, Math.min(state.step, current().steps.length - 1), true);
  else { state.scenario = null; renderTrace(); }
}

// ---- rail -------------------------------------------------------------------
function renderRail() {
  const rail = $('#rail-body');
  const keep = rail.scrollTop;
  rail.replaceChildren();
  const c = state.cfg, e = derived.e;

  const add = el('section', 'projects');
  add.append(el('h2', null, 'In the picture'));
  for (const p of PROJECTS) {
    const row = el('button', 'project');
    row.type = 'button';
    row.setAttribute('aria-pressed', String(!!c.on[p.id]));
    if (p.always) row.disabled = true;
    const name = el('span', 'project-name', p.name);
    const blurb = el('span', 'project-blurb', p.blurb + (p.needs ? ' Adds devbox-hardener.' : ''));
    row.append(el('span', 'switch'), name, ...(p.key ? [el('code', 'key-name project-key', p.key)] : []), blurb);
    row.addEventListener('click', () => {
      c.on[p.id] = !c.on[p.id];
      if (p.id === 'devbox' && !c.on.devbox) c.on.guard = false;
      apply();
    });
    add.append(row);
  }
  rail.append(add);

  for (const p of PROJECTS) {
    if (!c.on[p.id]) continue;
    const keys = KEYS.filter(k => k.project === p.id && keyShown(k, c));
    if (!keys.length) continue;
    const sec = el('section', 'keys');
    sec.append(el('h2', null, p.name));
    let group;
    for (const k of keys) {
      if (k.group !== group) { group = k.group; sec.append(el('h3', null, group)); }
      sec.append(keyRow(k, c, e));
    }
    rail.append(sec);
  }
  rail.scrollTop = keep;
}

function keyRow(k, c, e) {
  const row = el('div', 'key');
  row.id = `key-${k.id}`;
  const over = e.overrides[k.id];
  if (over) row.classList.add('overridden');
  const head = el('div', 'key-head');
  const name = el('code', 'key-name', keyName(k, c));
  head.append(name, el('span', 'key-where', k.setup ? `${k.where}, not a key` : k.where));
  const seg = el('div', 'seg');
  seg.setAttribute('role', k.multi ? 'group' : 'radiogroup');
  seg.setAttribute('aria-label', keyName(k, c));
  for (const o of keyOpts(k, c)) {
    const b = el('button', 'opt', o.label || o.v);
    b.type = 'button';
    const on = k.multi ? c[k.id].includes(o.v) : c[k.id] === o.v;
    b.setAttribute(k.multi ? 'aria-pressed' : 'aria-checked', String(on));
    if (!k.multi) b.setAttribute('role', 'radio');
    if (o.label) b.title = o.v;
    if (o.v.length > 14 && !o.label) b.classList.add('long');
    b.addEventListener('click', () => {
      if (k.multi) c[k.id] = on ? c[k.id].filter(v => v !== o.v) : [...c[k.id], o.v];
      else c[k.id] = o.v;
      apply();
    });
    seg.append(b);
  }
  row.append(head, seg, el('p', 'key-effect', k.effect));
  if (over) row.append(el('p', 'key-over', `Overridden: ${over}.`));
  return row;
}

function showKey(id) {
  const k = keyById[id];
  if (k && !state.cfg.on[k.project]) return;
  tab('rail');
  const row = document.getElementById(`key-${id}`);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

function keyChip(id) {
  const k = keyById[id];
  const v = derived.e[id];
  const b = el('button', 'chip');
  b.type = 'button';
  b.append(el('code', null, keyName(k, state.cfg)), document.createTextNode(' '), el('span', 'chip-v', Array.isArray(v) ? (v.join(', ') || 'none') : String(v)));
  b.title = 'Show this setting';
  b.addEventListener('click', () => showKey(id));
  return b;
}

// ---- scenarios --------------------------------------------------------------
function renderScenarios() {
  const box = $('#scenarios');
  box.replaceChildren();
  for (const p of PROJECTS) {
    const mine = list.filter(s => s.project === p.id);
    if (!mine.length) continue;
    const g = el('div', 'sc-group');
    g.append(el('h3', null, p.name));
    for (const s of mine) {
      const b = el('button', 'sc', s.title);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.scenario === s.id));
      b.addEventListener('click', () => { tab('side'); play(s.id, 0); });
      g.append(b);
    }
    box.append(g);
  }
}

const current = () => list.find(s => s.id === state.scenario);

function renderTrace() {
  const box = $('#trace');
  const s = current();
  $('#trace-title').textContent = s ? s.title : 'Pick something to happen';
  $('#controls').hidden = !s;
  box.replaceChildren();
  if (!s) {
    box.append(el('p', 'empty', 'Each one sends a request through the picture as it is configured now, and shows where it stops. Change a setting while it plays and it runs again.'));
    return;
  }
  const ol = el('ol', 'steps');
  s.steps.forEach((st, i) => {
    const li = el('li', `step v-${st.verdict}`);
    if (i === state.step) li.classList.add('now');
    if (i < state.step) li.classList.add('done');
    const b = el('button', 'step-head');
    b.type = 'button';
    b.append(el('span', 'mark', { ok: '✓', refused: '✕', warn: '!', info: '·' }[st.verdict]), el('span', 'step-title', st.title));
    b.addEventListener('click', () => play(s.id, i));
    li.append(b, el('p', 'step-detail', st.detail));
    if (st.keys.length) {
      const chips = el('div', 'chips');
      for (const k of st.keys) if (keyShown(keyById[k], state.cfg)) chips.append(keyChip(k));
      if (chips.children.length) li.append(chips);
    }
    ol.append(li);
  });
  box.append(ol);
  box.querySelector('.now')?.scrollIntoView({ block: 'nearest' });
  $('#play').textContent = state.playing ? 'Pause' : (state.step >= s.steps.length - 1 && !state.playing ? 'Replay' : 'Play');
}

function stopRun() { state.run++; state.playing = false; }

async function play(id, from = 0, resume = false) {
  stopRun();
  const run = state.run;
  state.scenario = id;
  state.playing = true;
  const s = current();
  stage.clearTrails();
  stage.mark([], 'gone'); stage.mark([], 'kept'); stage.mark([], 'lit');
  const gone = [], kept = [];
  for (let i = 0; i < from; i++) { gone.push(...(s.steps[i].gone || [])); kept.push(...(s.steps[i].kept || [])); }
  stage.mark(gone, 'gone'); stage.mark(kept, 'kept');
  renderScenarios();
  for (let i = from; i < s.steps.length; i++) {
    if (run !== state.run) return;
    state.step = i;
    renderTrace();
    const st = s.steps[i];
    stage.mark(st.path, 'lit');
    focus(st.path);
    await stage.travel(st.path, st.verdict, state.speed);
    if (run !== state.run) return;
    gone.push(...(st.gone || [])); kept.push(...(st.kept || []));
    stage.mark(gone, 'gone'); stage.mark(kept, 'kept');
    await new Promise(r => setTimeout(r, (resume ? 300 : 900) / state.speed));
    resume = false;
  }
  if (run !== state.run) return;
  state.playing = false;
  stage.mark([], 'lit');
  renderTrace();
}

$('#play').addEventListener('click', () => {
  const s = current();
  if (!s) return;
  if (state.playing) { stopRun(); renderTrace(); }
  else play(s.id, state.step >= s.steps.length - 1 ? 0 : state.step + 1);
});
$('#prev').addEventListener('click', () => current() && play(state.scenario, Math.max(0, state.step - 1)));
$('#next').addEventListener('click', () => current() && play(state.scenario, Math.min(current().steps.length - 1, state.step + 1)));
$('#speed').addEventListener('click', ev => {
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 0.5 : 1;
  ev.currentTarget.textContent = `${state.speed}×`;
});

// ---- inspector --------------------------------------------------------------
function pick(id) {
  state.picked = id;
  stage.mark([id], 'picked');
  renderInspector();
  tab('side', true);
}

function renderInspector() {
  const box = $('#inspector');
  box.replaceChildren();
  const n = state.picked && stage.nodes.get(state.picked);
  if (!n) {
    box.append(el('p', 'empty', 'Select anything in the picture to see what it is and which settings change it.'));
    return;
  }
  stage.mark([n.id], 'picked');
  box.append(el('h3', null, n.label || n.id));
  if (n.sub) box.append(el('p', 'ins-sub', n.sub));
  if (n.info?.what) box.append(el('p', 'ins-what', n.info.what));
  if (n.info?.facts?.length) {
    const ul = el('ul', 'facts');
    for (const f of n.info.facts) ul.append(el('li', null, f));
    box.append(ul);
  }
  const keys = (n.info?.keys || []).filter(k => keyShown(keyById[k], state.cfg));
  if (keys.length) {
    const chips = el('div', 'chips');
    keys.forEach(k => chips.append(keyChip(k)));
    box.append(el('h4', null, 'Settings that change it'), chips);
  }
}

// ---- stage: fit, zoom, pan, follow -----------------------------------------
function setScale(s, keepCentre = true) {
  const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / stage.scale, cy = (wrap.scrollTop + wrap.clientHeight / 2) / stage.scale;
  stage.scale = Math.max(0.2, Math.min(1.6, s));
  world.style.transform = `scale(${stage.scale})`;
  sizer.style.width = `${world.offsetWidth * stage.scale}px`;
  sizer.style.height = `${world.offsetHeight * stage.scale}px`;
  if (keepCentre) { wrap.scrollLeft = cx * stage.scale - wrap.clientWidth / 2; wrap.scrollTop = cy * stage.scale - wrap.clientHeight / 2; }
  $('#zoom-level').textContent = `${Math.round(stage.scale * 100)}%`;
}
function fit() {
  state.fit = true;
  const s = Math.min(1, (wrap.clientWidth - 16) / world.offsetWidth);
  setScale(Math.max(s, matchMedia('(max-width: 760px)').matches ? 0.42 : 0.2), false);
  wrap.scrollLeft = 0;
}
$('#zoom-in').addEventListener('click', () => { state.fit = false; setScale(stage.scale * 1.25); });
$('#zoom-out').addEventListener('click', () => { state.fit = false; setScale(stage.scale / 1.25); });
$('#zoom-fit').addEventListener('click', fit);
wrap.addEventListener('wheel', ev => {
  if (!ev.ctrlKey) return;
  ev.preventDefault();
  state.fit = false;
  setScale(stage.scale * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });
new ResizeObserver(() => { if (state.fit) fit(); else setScale(stage.scale); }).observe(wrap);

let drag = null;
wrap.addEventListener('pointerdown', ev => {
  if (ev.pointerType !== 'mouse' || ev.button !== 0 || ev.target.closest('button')) return;
  drag = { x: ev.clientX, y: ev.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
  wrap.setPointerCapture(ev.pointerId);
  wrap.classList.add('dragging');
});
wrap.addEventListener('pointermove', ev => {
  if (!drag) return;
  wrap.scrollLeft = drag.l - (ev.clientX - drag.x);
  wrap.scrollTop = drag.t - (ev.clientY - drag.y);
});
wrap.addEventListener('pointerup', () => { drag = null; wrap.classList.remove('dragging'); });

// Keep the moving packet in view when zoomed in.
function focus(ids) {
  const b = stage.bounds(ids);
  if (!b) return;
  const s = stage.scale, pad = 40;
  const vx0 = wrap.scrollLeft, vy0 = wrap.scrollTop, vx1 = vx0 + wrap.clientWidth, vy1 = vy0 + wrap.clientHeight;
  if (b.x0 * s >= vx0 + pad && b.x1 * s <= vx1 - pad && b.y0 * s >= vy0 + pad && b.y1 * s <= vy1 - pad) return;
  wrap.scrollTo({ left: ((b.x0 + b.x1) / 2) * s - wrap.clientWidth / 2, top: ((b.y0 + b.y1) / 2) * s - wrap.clientHeight / 2,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---- small screens: one panel under the picture at a time -------------------
function tab(which, soft = false) {
  if (soft && which === 'side' && document.body.dataset.tab === 'rail' && !matchMedia('(max-width: 1100px)').matches) return;
  document.body.dataset.tab = which;
  for (const b of document.querySelectorAll('[data-tab-for]')) b.setAttribute('aria-selected', String(b.dataset.tabFor === which));
}
for (const b of document.querySelectorAll('[data-tab-for]')) b.addEventListener('click', () => tab(b.dataset.tabFor));
tab('rail');

$('#reset').addEventListener('click', () => { state.cfg = defaults(); state.picked = null; state.scenario = null; apply(); });
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { state.picked = null; stage.mark([], 'picked'); renderInspector(); }
});

apply();
