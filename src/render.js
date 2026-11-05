// Draws the containment tree as nested elements (CSS does the layout) and an
// SVG overlay for links and the lines a scenario draws. Elements are keyed by node id, so
// a config change only touches what changed, and anything that moved glides
// from where it was.

const SVG = 'http://www.w3.org/2000/svg';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Stage {
  constructor(world, onPick, onPickLine) {
    this.world = world;
    this.onPick = onPick;
    this.onPickLine = onPickLine;
    this.els = new Map();
    this.nodes = new Map();
    this.scale = 1;
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('wires');
    this.links = document.createElementNS(SVG, 'g');
    this.trails = document.createElementNS(SVG, 'g');
    const defs = document.createElementNS(SVG, 'defs');
    for (const v of ['ok', 'refused', 'warn', 'info']) {
      const m = document.createElementNS(SVG, 'marker');
      Object.entries({ id: `arrow-${v}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
        .forEach(([k, val]) => m.setAttribute(k, val));
      const tip = document.createElementNS(SVG, 'path');
      tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      tip.setAttribute('class', `tip v-${v}`);
      m.append(tip);
      defs.append(m);
    }
    this.svg.append(defs, this.links, this.trails);
    world.append(this.svg);
    this.settled = Promise.resolve();
  }

  update(tree, edges) {
    const before = new Map();
    for (const [id, el] of this.els) before.set(id, el.getBoundingClientRect());
    const seen = new Set();
    this.nodes.clear();
    tree.children.forEach((c, i) => this.build(c, this.world, i, seen));
    for (const [id, el] of this.els) if (!seen.has(id)) { el.remove(); this.els.delete(id); }
    this.edges = edges;
    const moved = this.flip(before);
    this.links.replaceChildren();
    const wait = moved ? 480 : 0;
    this.settled = new Promise(r => setTimeout(() => { this.drawLinks(); r(); }, wait));
    return this.settled;
  }

  build(node, parent, index, seen) {
    seen.add(node.id);
    this.nodes.set(node.id, node);
    const isBox = Array.isArray(node.children);
    let el = this.els.get(node.id);
    if (!el || (el.dataset.box === '1') !== isBox) {
      el?.remove();
      el = isBox ? this.makeBox(node) : this.makeLeaf(node);
      el.classList.add('entering');
      this.els.set(node.id, el);
    }
    el.className = el.className.replace(/\b(k|t|o)-\S+/g, '').replace(/\bempty\b/, '').trim();
    el.classList.add(`k-${node.kind}`);
    if (node.own) el.classList.add(`o-${node.own}`);
    if (node.tone) el.classList.add(`t-${node.tone}`);
    el.classList.toggle('on-wall', !!node.wall);
    el.querySelector(':scope > .n-head .n-label, :scope > .n-label').textContent = node.label || '';
    const sub = el.querySelector(':scope > .n-head .n-sub, :scope > .n-sub');
    sub.textContent = node.sub || '';
    sub.hidden = !node.sub;
    if (isBox) {
      const head = el.querySelector(':scope > .n-head');
      head.hidden = !node.label && !node.sub;
      let ref = el.querySelector(':scope > .n-refused');
      if (node.refused?.length) {
        if (!ref) { ref = document.createElement('div'); ref.className = 'n-refused'; ref.setAttribute('role', 'alert'); head.after(ref); }
        const h = document.createElement('strong');
        h.textContent = 'dejima refuses to launch';
        ref.replaceChildren(h, ...node.refused.map(t => Object.assign(document.createElement('p'), { textContent: t })));
      } else ref?.remove();
      el.classList.toggle('empty', node.children.length === 0);
      const kids = el.querySelector(':scope > .n-kids');
      let i = 0;
      for (const c of node.children) {
        if (c.wall) this.build(c, el, 0, seen);
        else this.build(c, kids, i++, seen);
      }
    }
    const at = parent.children[index];
    if (node.wall) { if (el.parentNode !== parent) parent.prepend(el); }
    else if (at !== el) parent.insertBefore(el, at || null);
  }

  makeBox(node) {
    const el = document.createElement('section');
    el.className = 'n box';
    el.dataset.id = node.id;
    el.dataset.box = '1';
    const head = document.createElement('button');
    head.className = 'n-head';
    head.type = 'button';
    head.append(span('n-label'), span('n-sub'));
    head.addEventListener('click', ev => { ev.stopPropagation(); this.onPick(node.id); });
    const kids = document.createElement('div');
    kids.className = 'n-kids';
    el.append(head, kids);
    return el;
  }

  makeLeaf(node) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'n leaf';
    el.dataset.id = node.id;
    el.dataset.box = '0';
    el.append(span('n-label'), span('n-sub'));
    el.addEventListener('click', ev => { ev.stopPropagation(); this.onPick(node.id); });
    return el;
  }

  flip(before) {
    if (reduced()) { for (const el of this.els.values()) el.classList.remove('entering'); return false; }
    const after = new Map();
    for (const [id, el] of this.els) after.set(id, el.getBoundingClientRect());
    const delta = id => {
      const b = before.get(id), a = after.get(id);
      return b && a ? [a.left - b.left, a.top - b.top] : [0, 0];
    };
    let moved = false;
    for (const [id, el] of this.els) {
      if (el.classList.contains('entering')) {
        el.classList.remove('entering');
        if (before.size) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 160, fill: 'backwards' });
        continue;
      }
      const up = el.parentElement?.closest('[data-id]');
      const [dx, dy] = delta(id);
      const [px, py] = up ? delta(up.dataset.id) : [0, 0];
      const rx = (dx - px) / this.scale, ry = (dy - py) / this.scale;
      if (Math.abs(rx) < 1 && Math.abs(ry) < 1) continue;
      moved = true;
      el.animate([{ transform: `translate(${-rx}px, ${-ry}px)` }, { transform: 'none' }],
        { duration: 460, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
    return moved;
  }

  // Centre of a node in world coordinates.
  point(id) {
    const el = this.els.get(id);
    if (!el) return null;
    const w = this.world.getBoundingClientRect();
    const target = el.dataset.box === '1' ? el.querySelector(':scope > .n-head .n-label') : el;
    const r = target.getBoundingClientRect();
    return [(r.left + r.width / 2 - w.left) / this.scale, (r.top + r.height / 2 - w.top) / this.scale];
  }

  // Where a line meets a node: on its outline, towards `toward`, pulled a
  // little inside so it is plain which box the end belongs to.
  edgePoint(id, toward) {
    const el = this.els.get(id);
    const w = this.world.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - w.left) / this.scale;
    const cy = (r.top + r.height / 2 - w.top) / this.scale;
    const hw = Math.max(1, r.width / 2 / this.scale - 6), hh = Math.max(1, r.height / 2 / this.scale - 6);
    const dx = toward[0] - cx, dy = toward[1] - cy;
    if (Math.abs(dx) * hh > Math.abs(dy) * hw) return [cx + Math.sign(dx) * hw, cy + dy * hw / Math.abs(dx || 1)];
    return [cx + dx * hh / Math.abs(dy || 1), cy + Math.sign(dy) * hh];
  }

  // A visible line, a dot at each end, and a wider invisible stroke that
  // takes the click.
  line(parent, d, cls, ends, onClick) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    parent.append(p);
    for (const [x, y] of ends) {
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 3.5);
      dot.setAttribute('class', `anchor ${cls}`);
      parent.append(dot);
    }
    const hit = document.createElementNS(SVG, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('class', 'hit');
    hit.addEventListener('click', ev => {
      ev.stopPropagation();
      for (const h of this.svg.querySelectorAll('.picked-line')) h.classList.remove('picked-line');
      parent.classList.add('picked-line');
      onClick();
    });
    parent.append(hit);
    return p;
  }

  drawLinks() {
    this.links.replaceChildren();
    for (const l of this.edges || []) {
      const a0 = this.point(l.from), b0 = this.point(l.to);
      if (!a0 || !b0) continue;
      const a = this.edgePoint(l.from, b0), b = this.edgePoint(l.to, a0);
      const g = document.createElementNS(SVG, 'g');
      g.dataset.ends = `${l.from} ${l.to}`;
      g.setAttribute('class', 'link-g');
      const mx = (a[0] + b[0]) / 2;
      this.line(g, `M${a[0]},${a[1]} C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`, `link l-${l.kind}`, [a, b],
        () => this.onPickLine({ kind: 'link', link: l }));
      this.links.append(g);
    }
    this.svg.animate?.([{ opacity: 0.2 }, { opacity: 1 }], { duration: 200 });
  }

  clearTrails() { this.trails.replaceChildren(); this.caption?.remove(); this.caption = null; }

  // Draw one step: its line fades in whole, arrowed towards where it ends,
  // with the step's title beside the end. `instant` draws it already dimmed,
  // for steps passed. Resolves once it has been on screen long enough to read.
  travel(ids, verdict, speed = 1, { instant = false, title = '', step = null } = {}) {
    const pts = ids.map(id => this.point(id)).filter(Boolean);
    if (!pts.length) return Promise.resolve();
    for (const t of this.trails.children) t.classList.add('old');
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', `step-mark v-${verdict}`);
    this.trails.append(g);
    let path = null;
    let end = pts[pts.length - 1];
    const pick = () => step && this.onPickLine({ kind: 'step', step });
    if (pts.length > 1) {
      // A leaf's line starts and stops at its outline; a box's at its label.
      const first = this.els.get(ids[0])?.dataset.box === '1' ? pts[0] : this.edgePoint(ids[0], pts[1]);
      const lastId = ids[ids.length - 1];
      if (this.els.get(lastId)?.dataset.box !== '1') end = this.edgePoint(lastId, pts[pts.length - 2]);
      const p2 = [first, ...pts.slice(1, -1), end];
      path = this.line(g, smooth(p2), `trail v-${verdict}`, [first], pick);
      path.setAttribute('marker-end', `url(#arrow-${verdict})`);
    }
    const b = this.burst(end, verdict);
    b.addEventListener('click', ev => { ev.stopPropagation(); pick(); });
    g.append(b);
    if (instant) { g.classList.add('old'); return Promise.resolve(); }
    if (title) this.captionAt(title, verdict, path, end);
    if (!reduced()) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
    return wait(900 / speed);
  }

  // The caption sits beside the end of the line, on whichever side of it
  // covers least of the picture, and stays where it was put.
  captionAt(title, verdict, path, end) {
    this.caption?.remove();
    const el = document.createElement('div');
    el.className = `caption v-${verdict}`;
    el.textContent = title;
    el.setAttribute('aria-hidden', 'true');
    this.world.append(el);
    this.caption = el;
    const w = el.offsetWidth, h = el.offsetHeight, gap = 14;
    // Direction of travel into the end point, so a caption beside the line
    // can sit just before it rather than over where it arrives.
    let dx = 0, dy = -1;
    if (path) {
      const len = path.getTotalLength();
      const a = path.getPointAtLength(Math.max(0, len - 40));
      const n = Math.hypot(end[0] - a.x, end[1] - a.y) || 1;
      dx = (end[0] - a.x) / n; dy = (end[1] - a.y) / n;
    }
    const back = [end[0] - dx * 40, end[1] - dy * 40];
    const px = -dy, py = dx;
    const candidates = [
      [back[0] + px * (gap + h / 2) - w / 2, back[1] + py * (gap + h / 2) - h / 2],
      [back[0] - px * (gap + h / 2) - w / 2, back[1] - py * (gap + h / 2) - h / 2],
      [end[0] + gap, end[1] - h - gap], [end[0] + gap, end[1] + gap],
      [end[0] - w - gap, end[1] - h - gap], [end[0] - w - gap, end[1] + gap],
    ];
    const wr = this.world.getBoundingClientRect();
    const solid = [...this.world.querySelectorAll('.leaf, .n-head:not([hidden])')].map(n => {
      const r = n.getBoundingClientRect();
      return [(r.left - wr.left) / this.scale, (r.top - wr.top) / this.scale, (r.right - wr.left) / this.scale, (r.bottom - wr.top) / this.scale];
    });
    const maxX = this.world.offsetWidth - w, maxY = this.world.offsetHeight - h;
    const clamp = ([x, y]) => [Math.max(0, Math.min(maxX, x)), Math.max(0, Math.min(maxY, y))];
    const cost = ([x, y]) => solid.reduce((sum, [a, b, c, d]) =>
      sum + Math.max(0, Math.min(c, x + w) - Math.max(a, x)) * Math.max(0, Math.min(d, y + h) - Math.max(b, y)), 0);
    let best = clamp(candidates[0]), bestCost = Infinity;
    for (const c of candidates.map(clamp)) { const k = cost(c); if (k < bestCost) { best = c; bestCost = k; } }
    el.style.transform = `translate(${best[0]}px, ${best[1]}px)`;
    if (!reduced()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120, fill: 'backwards' });
  }

  burst([x, y], verdict) {
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', `burst v-${verdict}`);
    g.setAttribute('transform', `translate(${x},${y})`);
    const ring = document.createElementNS(SVG, 'circle');
    ring.setAttribute('r', 14);
    g.append(ring);
    if (verdict === 'refused') {
      const x1 = document.createElementNS(SVG, 'path');
      x1.setAttribute('d', 'M-6,-6 L6,6 M6,-6 L-6,6');
      g.append(x1);
    }
    return g;
  }

  mark(ids, cls) {
    for (const el of this.world.querySelectorAll(`.${cls}`)) el.classList.remove(cls);
    for (const id of ids) this.els.get(id)?.classList.add(cls);
    if (cls !== 'gone') return;
    for (const p of this.links.children) {
      const ends = p.dataset.ends.split(' ').map(id => this.els.get(id));
      p.classList.toggle('gone', ends.some(e => e?.closest('.gone')));
    }
  }

  bounds(ids) {
    const pts = ids.map(id => this.point(id)).filter(Boolean);
    if (!pts.length) return null;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
}

function span(c) { const s = document.createElement('span'); s.className = c; return s; }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Catmull-Rom through the points, as cubic Béziers.
function smooth(p) {
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}
