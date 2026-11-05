import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, PROJECTS, defaults, normalise, keyOpts } from '../src/config.js';
import { derive } from '../src/topology.js';
import { scenarios } from '../src/scenarios.js';

function* walk(n) { yield n; for (const c of n.children || []) yield* walk(c); }

// Deterministic pseudo-random configs across every key and project toggle.
function configs(count) {
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = defaults();
    for (const p of PROJECTS) if (!p.always) c.on[p.id] = rnd(2) === 1;
    for (const k of KEYS) {
      const opts = keyOpts(k, c).map(o => o.v);
      c[k.id] = k.multi ? opts.filter(() => rnd(2)) : opts[rnd(opts.length)];
    }
    out.push(normalise(c));
  }
  return out;
}

const all = [defaults(), ...configs(3000)];

test('node ids are unique', () => {
  for (const c of all) {
    const ids = [...walk(derive(c).root)].map(n => n.id);
    assert.equal(new Set(ids).size, ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join());
  }
});

test('every scenario path and link names a drawn node', () => {
  for (const c of all) {
    const d = derive(c);
    const ids = new Set([...walk(d.root)].map(n => n.id));
    for (const l of d.edges) for (const end of [l.from, l.to]) assert.ok(ids.has(end), `link ${l.id}`);
    for (const s of scenarios(c, d)) {
      assert.ok(s.steps.length, `${s.id} has no steps`);
      for (const st of s.steps) {
        assert.ok(st.path.length, `${s.id}: empty path`);
        for (const id of st.path) assert.ok(ids.has(id), `${s.id} "${st.title}": ${id} missing (${JSON.stringify(c.on)})`);
        for (const id of [...(st.gone || []), ...(st.kept || [])]) assert.ok(typeof id === 'string');
      }
    }
  }
});

test('keys named by nodes and steps exist', () => {
  const known = new Set(KEYS.map(k => k.id));
  for (const c of all) {
    const d = derive(c);
    for (const n of walk(d.root)) for (const k of n.info?.keys || []) assert.ok(known.has(k), `${n.id}: ${k}`);
    for (const s of scenarios(c, d)) for (const st of s.steps) for (const k of st.keys) assert.ok(known.has(k), `${s.id}: ${k}`);
  }
});

test('every refusal and every step explains itself', () => {
  for (const c of all) {
    const d = derive(c);
    for (const s of scenarios(c, d)) for (const st of s.steps) {
      assert.ok(st.title && st.detail, `${s.id}`);
      assert.ok(['ok', 'refused', 'warn', 'info'].includes(st.verdict), `${s.id}: ${st.verdict}`);
    }
  }
});

test('dejima refusals match the docs', () => {
  const r = o => { const c = normalise(Object.assign(defaults(), o)); return derive(c).refused; };
  assert.equal(r({}).length, 0);
  assert.match(r({ sealed: 'on' })[0], /platform\.claude\.com/);
  assert.equal(r({ sealed: 'on', harness: 'cline', backend: 'self-hosted' }).length, 0);
  assert.match(r({ sealed: 'on', harness: 'cline', backend: 'self-hosted', base_url: 'http://llm.example.lan:11434' })[0], /llm\.example\.lan/);
  assert.match(r({ internal: 'wiki.example.lan' })[0], /never permits/);
  assert.equal(r({ internal: 'wiki.example.lan', allowed: ['wiki.example.lan'] }).length, 0);
  assert.match(r({ workflow: 'branch-push' })[0], /needs a forge/);
  assert.equal(r({ workflow: 'branch-push', isolated: 'on' }).length, 0, '--isolated forces local-only');
});

test('devbox-hardener moves dejima onto the Proxmox node', () => {
  const c = defaults();
  const where = cfg => { for (const n of walk(derive(cfg).root)) if ((n.children || []).some(k => k.id === 'dejima-host')) return n.id; };
  assert.equal(where(c), 'laptop');
  c.on.devbox = true;
  assert.equal(where(c), 'vm-devbox');
});
