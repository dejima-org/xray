// Every distinct verdict the picture can show, each with the smallest
// configuration that produces it. The rows are what gets verified against
// the projects' code; see docs/keeping-current.md.
//
//   node tools/matrix.mjs                 print the rows as JSON
//   node tools/matrix.mjs --diff FILE     print, as markdown grouped by
//                                         project, the rows FILE does not hold
import { KEYS, PROJECTS, defaults, normalise, keyOpts } from '../src/config.js';
import { derive } from '../src/topology.js';
import { scenarios } from '../src/scenarios.js';
import { readFileSync } from 'node:fs';

const D = defaults();
const variants = (k, c) => {
  const opts = keyOpts(k, c).map(o => o.v);
  return k.multi ? [[], ...opts.map(v => [v]), opts] : opts;
};
const fresh = on => { const c = defaults(); for (const p of on) c.on[p] = true; return c; };

// Defaults, then every single change and every pair of changes, over the
// project combinations that change what is drawn.
const sets = [[], ['remote'], ['devbox'], ['ci'], ['guard'], ['darner'], ['remote', 'devbox'], ['darner', 'devbox', 'remote']];
const configs = [];
for (const on of sets) {
  const keys = KEYS.filter(k => k.project === 'dejima' || on.includes(k.project) || (k.project === 'devbox' && on.includes('guard')));
  const bases = [fresh(on)];
  for (const base of [fresh(on), Object.assign(fresh(on), { harness: 'cline', cline_model: 'set' })]) {
    bases.push(base);
    for (const backend of ['openrouter', 'self-hosted']) bases.push(Object.assign(fresh(on), { harness: 'cline', cline_model: 'set', backend }));
  }
  for (const base of bases) {
    configs.push(normalise(structuredClone(base)));
    for (let i = 0; i < keys.length; i++) {
      for (const a of variants(keys[i], base)) {
        const one = normalise(Object.assign(structuredClone(base), { [keys[i].id]: a }));
        configs.push(one);
        for (let j = i + 1; j < keys.length; j++)
          for (const b of variants(keys[j], one))
            configs.push(normalise(Object.assign(structuredClone(one), { [keys[j].id]: b })));
      }
    }
  }
}

const diff = c => {
  const out = [];
  for (const p of PROJECTS) if (c.on[p.id] !== D.on[p.id]) out.push(`+${p.id}`);
  for (const k of KEYS) if (c.on[k.project] !== false && JSON.stringify(c[k.id]) !== JSON.stringify(D[k.id])) out.push(`${k.id}=${JSON.stringify(c[k.id])}`);
  return out;
};

export function rows() {
  const found = new Map();
  for (const c of configs) {
    const d = derive(c);
    const add = row => {
      const key = [row.scenario, row.step, row.verdict, row.path, row.detail].join('\u0000');
      const cfg = diff(c);
      const cur = found.get(key);
      if (!cur || cfg.length < cur.cfg.length || (cfg.length === cur.cfg.length && cfg.join() < cur.cfg.join())) found.set(key, { ...row, cfg });
    };
    if (d.refused.length) add({ project: 'dejima', scenario: '(launch refusal)', step: '', verdict: 'refused', path: '', detail: d.refused[0] });
    for (const s of scenarios(c, d)) for (const st of s.steps)
      add({ project: s.project, scenario: s.id, step: st.title, verdict: st.verdict, path: st.path.join(' → '), detail: st.detail });
  }
  return [...found.values()].sort((a, b) =>
    (a.project + a.scenario + a.step + a.verdict + a.path + a.detail).localeCompare(b.project + b.scenario + b.step + b.verdict + b.path + b.detail));
}

const id = r => [r.scenario, r.step, r.verdict, r.path, r.detail].join('\u0000');

function markdown(list) {
  const legend = KEYS.map(k => `${k.id}: ${typeof k.key === 'function' ? '[harness.<h>] backend' : k.key}`).join('; ');
  const out = ['Each row: the smallest config (a diff from the defaults) under which the picture shows this verdict. ok = allowed and delivered; refused = stopped at the last node of the path; warn = allowed, with a caveat; info = no traffic decision.', '', `Config ids: ${legend}`];
  for (const p of PROJECTS) {
    const mine = list.filter(r => r.project === p.id);
    if (!mine.length) continue;
    out.push('', `## ${p.name}`, '');
    mine.forEach((r, i) => out.push(`${i + 1}. **${r.scenario}** / ${r.step || '-'} → **${r.verdict}**  \n   config: \`${r.cfg.join(' ') || '(defaults)'}\`  \n   path: ${r.path || '-'}  \n   says: ${r.detail}`));
  }
  return out.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = rows();
  const at = process.argv.indexOf('--diff');
  if (at < 0) process.stdout.write(JSON.stringify(all, null, 1) + '\n');
  else {
    const known = new Set(JSON.parse(readFileSync(process.argv[at + 1], 'utf8')).map(id));
    const changed = all.filter(r => !known.has(id(r)));
    process.stderr.write(`${changed.length} of ${all.length} rows are not in ${process.argv[at + 1]}\n`);
    process.stdout.write(markdown(changed));
  }
}
