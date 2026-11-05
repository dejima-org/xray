// Draws the containment tree as nested elements (CSS does the layout) and an
// SVG overlay for links and moving packets. Elements are keyed by node id, so
// a config change only touches what changed, and anything that moved glides
// from where it was.

const SVG = 'http://www.w3.org/2000/svg';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Stage {
  constructor(world, onPick) {
    this.world = world;
    this.onPick = onPick;
    this.els = new Map();
    this.nodes = new Map();
    this.scale = 1;
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('wires');
    this.links = document.createElementNS(SVG, 'g');
    this.trails = document.createElementNS(SVG, 'g');
    this.svg.append(this.links, this.trails);
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
    el.className = el.className.replace(/\b(k|t)-\S+/g, '').replace(/\bempty\b/, '').trim();
    el.classList.add(`k-${node.kind}`);
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
    const target = el.dataset.box === '1' ? el.querySelector(':scope > .n-head') : el;
    const r = target.getBoundingClientRect();
    return [(r.left + r.width / 2 - w.left) / this.scale, (r.top + r.height / 2 - w.top) / this.scale];
  }

  edgePoint(id, toward) {
    const el = this.els.get(id);
    const w = this.world.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - w.left) / this.scale;
    const cy = (r.top + r.height / 2 - w.top) / this.scale;
    const hw = r.width / 2 / this.scale, hh = r.height / 2 / this.scale;
    const dx = toward[0] - cx, dy = toward[1] - cy;
    if (Math.abs(dx) * hh > Math.abs(dy) * hw) return [cx + Math.sign(dx) * hw, cy + dy * hw / Math.abs(dx || 1)];
    return [cx + dx * hh / Math.abs(dy || 1), cy + Math.sign(dy) * hh];
  }

  drawLinks() {
    this.links.replaceChildren();
    for (const l of this.edges || []) {
      const a0 = this.point(l.from), b0 = this.point(l.to);
      if (!a0 || !b0) continue;
      const a = this.edgePoint(l.from, b0), b = this.edgePoint(l.to, a0);
      const p = document.createElementNS(SVG, 'path');
      const mx = (a[0] + b[0]) / 2;
      p.setAttribute('d', `M${a[0]},${a[1]} C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`);
      p.setAttribute('class', `link l-${l.kind}`);
      this.links.append(p);
    }
    this.svg.animate?.([{ opacity: 0.2 }, { opacity: 1 }], { duration: 200 });
  }

  clearTrails() { this.trails.replaceChildren(); }

  // Move a packet through the centres of `ids`. Resolves when it arrives.
  travel(ids, verdict, speed = 1) {
    const pts = ids.map(id => this.point(id)).filter(Boolean);
    if (!pts.length) return Promise.resolve();
    const cls = `v-${verdict}`;
    if (pts.length === 1) { this.burst(pts[0], verdict); return wait(500 / speed); }
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', smooth(pts));
    path.setAttribute('class', `trail ${cls}`);
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('r', 6);
    dot.setAttribute('class', `packet ${cls}`);
    this.trails.append(path, dot);
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    const dur = Math.min(2200, Math.max(600, len * 1.4)) / speed;
    if (reduced()) {
      path.style.strokeDashoffset = '0';
      dot.remove();
      this.burst(pts[pts.length - 1], verdict);
      return wait(250);
    }
    return new Promise(res => {
      const t0 = performance.now();
      const tick = now => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const p = path.getPointAtLength(e * len);
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        path.style.strokeDashoffset = `${len * (1 - e)}`;
        if (t < 1) requestAnimationFrame(tick);
        else { dot.remove(); this.burst(pts[pts.length - 1], verdict); res(); }
      };
      requestAnimationFrame(tick);
    });
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
    this.trails.append(g);
  }

  mark(ids, cls) {
    for (const el of this.world.querySelectorAll(`.${cls}`)) el.classList.remove(cls);
    for (const id of ids) this.els.get(id)?.classList.add(cls);
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
