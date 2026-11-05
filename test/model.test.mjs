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

test('a refused packet never reaches its destination', () => {
  for (const c of all) {
    const d = derive(c);
    for (const s of scenarios(c, d)) for (const st of s.steps) {
      if (st.verdict !== 'refused') continue;
      const last = st.path[st.path.length - 1];
      assert.ok(!/^(lan|net)-/.test(last), `${s.id} "${st.title}" ends at ${last}`);
    }
  }
});

test('dejima refusals match dejima\'s own checks', () => {
  const r = o => { const c = normalise(Object.assign(defaults(), o)); return derive(c).refused; };
  const cline = { harness: 'cline', cline_model: 'set', cline_backend: 'anthropic' };
  assert.equal(r({}).length, 0);
  // provider checks come first
  assert.match(r({ workflow: 'branch-push' })[0], /nowhere to push/);
  assert.match(r({ workflow: 'worktree-pr' })[0], /'pr' capability/);
  assert.equal(r({ workflow: 'branch-push', isolated: 'on' }).length, 0, '--isolated forces local-only');
  // cline has no default model, and refuses before anything else of its own
  assert.match(r({ harness: 'cline' })[0], /no model is configured/);
  assert.match(r({ harness: 'cline', proxy: 'off' })[0], /no model is configured/);
  // cline cannot reach a proxied backend without the proxy and its TLS terminator
  assert.match(r({ ...cline, proxy: 'off' })[0], /proxy is off/);
  assert.match(r({ ...cline, transport: 'loopback' })[0], /loopback/);
  assert.equal(r({ proxy: 'off' }).length, 0, 'only claude-code runs with the credential mounted');
  // a self-hosted name must already be approved; isolated reads global approvals only
  const byName = { ...cline, cline_backend: 'self-hosted', base_url: 'http://llm.example.lan:11434' };
  assert.match(r(byName)[0], /not host-local and not approved/);
  assert.equal(r({ ...byName, allowed: ['llm.example.lan'] }).length, 0);
  assert.match(r({ ...byName, allowed: ['llm.example.lan'], isolated: 'on' })[0], /global approvals only/);
  assert.equal(r({ ...byName, global: ['llm.example.lan'], isolated: 'on' }).length, 0);
  // sealed: firewall off and claude-code are refused before the build
  assert.match(r({ sealed: 'on' })[0], /platform\.claude\.com/);
  assert.match(r({ sealed: 'on', firewall: 'off' })[0], /firewall = off/);
  assert.equal(r({ ...cline, sealed: 'on', cline_backend: 'self-hosted' }).length, 0);
  assert.equal(r({ ...cline, sealed: 'on' }).length, 0, 'a proxied backend keeps its name off the allowlist');
  assert.match(r({ ...cline, sealed: 'on', allowed: ['pypi.org'] })[0], /not sealed/);
  // internal_domains never permits; under --drop-domains it is ignored instead
  assert.match(r({ internal: 'wiki.example.lan' })[0], /never permits/);
  assert.equal(r({ internal: 'wiki.example.lan', drop: 'on' }).length, 0);
  // a permitted name answering privately fails the filter's self-check unless exempt
  assert.match(r({ allowed: ['wiki.example.lan'] })[0], /check 7/);
  assert.match(r({ global: ['wiki.example.lan'] })[0], /check 7/);
  assert.equal(r({ allowed: ['wiki.example.lan'], internal: 'wiki.example.lan' }).length, 0);
  assert.equal(r({ allowed: ['wiki.example.lan'], isolated: 'on' }).length, 0, 'isolated reads no project approvals');
  assert.match(r({ allowed: ['llm.example.lan'] })[0], /check 7/, 'an approval alone is not an exemption');
  assert.equal(r({ ...byName, allowed: ['llm.example.lan'] }).length, 0, 'the base_url host is exempt');
  assert.equal(r({ forge: 'gitea' }).length, 0, 'the forge is exempt');
  assert.equal(r({ global: ['wiki.example.lan'], drop: 'on' }).length, 0, '--drop-domains drops global approvals');
  // cline has no default backend either
  assert.match(r({ ...cline, cline_backend: 'unset' })[0], /no \[harness.cline\] backend/);
  // only the first refusal is ever printed
  assert.equal(r({ sealed: 'on', internal: 'wiki.example.lan' }).length, 1);
});

test('the forwarded names match the policy', () => {
  const n = o => derive(normalise(Object.assign(defaults(), o))).names.map(x => x.name);
  assert.equal(n({}).length, 7, 'built-ins, api.github.com, and platform.claude.com');
  assert.ok(n({}).includes('api.github.com'));
  assert.deepEqual(n({ drop: 'on' }), ['platform.claude.com']);
  assert.equal(n({ ...{ harness: 'cline', cline_model: 'set', cline_backend: 'anthropic' }, drop: 'on' }).length, 0);
});

test('blocked branches come from the workflow, not from having a push host', () => {
  const steps = o => { const c = normalise(Object.assign(defaults(), o)); const d = derive(c); return scenarios(c, d).find(s => s.id === 'push').steps; };
  const main = o => steps(o).find(st => st.title === 'git push origin main');
  assert.equal(main({ ghpush: 'on' }).verdict, 'warn', 'local-only blocks no branch, so --allow-github-push lets main through');
  assert.equal(main({ workflow: 'branch-push', forge: 'gitea' }).verdict, 'refused');
  assert.ok(steps({ forge: 'gitea' }).some(st => /merge/.test(st.title)), 'local-only still blocks merges');
});

test('devbox-hardener moves dejima onto the Proxmox node', () => {
  const c = defaults();
  const where = cfg => { for (const n of walk(derive(cfg).root)) if ((n.children || []).some(k => k.id === 'dejima-host')) return n.id; };
  assert.equal(where(c), 'laptop');
  c.on.devbox = true;
  assert.equal(where(c), 'vm-devbox');
});
