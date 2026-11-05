// Compares sources.json with what each project's forge has now, and says
// which pins have fallen behind. Exits 1 if any has. Reads refs only, with
// git ls-remote, so it needs read access to the repositories and nothing else.
//
//   node tools/check-sources.mjs
//   XRAY_FORGE=git@forge.example.com: node tools/check-sources.mjs
//
// XRAY_FORGE is the prefix a repository path ("dejima/dejima") is appended
// to, with ".git" after it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const forge = process.env.XRAY_FORGE || 'https://gitbox.branderson.io/';
const sources = JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8'));

const refs = repo => execFileSync('git', ['ls-remote', '--refs', `${forge}${repo}.git`], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] })
  .trim().split('\n').map(l => l.split('\t')).map(([sha, ref]) => ({ sha, ref }));
const released = list => list.filter(r => r.ref.startsWith('refs/tags/')).map(r => r.ref.slice(10))
  .filter(t => /^v?\d+(\.\d+)+$/.test(t))
  .sort((a, b) => a.replace(/^v/, '').localeCompare(b.replace(/^v/, ''), undefined, { numeric: true }));

let behind = 0;
for (const [name, pin] of Object.entries(sources)) {
  let list;
  try { list = refs(pin.repo); } catch (err) { console.log(`${name}: could not read ${forge}${pin.repo}.git (${err.message.split('\n')[0]})`); behind++; continue; }
  const head = list.find(r => r.ref === `refs/heads/${pin.ref || 'main'}`)?.sha;
  const latest = released(list).at(-1);
  const notes = [];
  if (pin.release) {
    if (latest && latest.replace(/^v/, '') !== pin.release) notes.push(`release ${latest} is out; the picture shows ${pin.release}`);
  } else if (latest && pin.version && latest.replace(/^v/, '') !== pin.version) {
    notes.push(`release ${latest} is out; the picture shows ${pin.version} from ${pin.ref}`);
  }
  if (!pin.release && head && head !== pin.commit) notes.push(`${pin.ref} has moved: ${pin.commit.slice(0, 7)} -> ${head.slice(0, 7)}`);
  if (notes.length) behind++;
  console.log(`${name}: ${notes.length ? notes.join('; ') : 'current'}`);
}
process.exit(behind ? 1 : 0);
