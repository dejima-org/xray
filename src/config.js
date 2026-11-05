// Every setting the picture responds to. `key` is the real name as an operator
// would write it; `where` is the file or command it lives in. Options are the
// values the picture can show, not every value the tool accepts.

export const PROJECTS = [
  { id: 'dejima', name: 'dejima', always: true,
    blurb: 'The sandbox: a session container that can only reach what its filter allows.' },
  { id: 'remote', name: 'remote access', key: '[remote-access] enabled', blurb: 'Reach your sessions from a phone, over the web or SSH.' },
  { id: 'devbox', name: 'dejima-devbox-hardener', blurb: 'Moves dejima onto a Proxmox VM whose LAN reach is fenced from outside the guest.' },
  { id: 'ci', name: 'dejima-ci-hardener', blurb: 'CI runners on Proxmox VMs, fenced off your LAN. Confined runners reach only what main declares.' },
  { id: 'guard', name: 'dejima-guard', blurb: 'A second machine that checks the devbox every 15 minutes.', needs: ['devbox'] },
  { id: 'darner', name: 'darner', blurb: 'Send a task from Matrix or a web page; get the result back.' },
];

const onOff = [{ v: 'on' }, { v: 'off' }];

export const KEYS = [
  // dejima: [core] and friends, ~/.config/dejima/config
  { id: 'harness', project: 'dejima', group: 'Agent', where: '~/.config/dejima/config', key: '[core] harness',
    opts: [{ v: 'claude-code' }, { v: 'cline' }], def: 'claude-code',
    effect: 'Which agent runs in the session container, and which guards it hosts. Required: there is no default.' },
  { id: 'backend', project: 'dejima', group: 'Agent', where: '~/.config/dejima/config',
    key: c => `[harness.${c.harness}] backend`,
    opts: c => (c.harness === 'cline'
      ? ['unset', 'anthropic', 'anthropic-api-key', 'openrouter', 'self-hosted']
      : ['anthropic', 'anthropic-api-key']).map(v => ({ v })),
    def: 'anthropic',
    effect: 'Where the model is. Proxied backends keep the credential on the host; self-hosted has none to keep. cline has no default; claude-code gets anthropic written in once. openrouter is drawn with its credential_file set.' },
  { id: 'cline_model', project: 'dejima', group: 'Agent', where: '~/.config/dejima/config', key: '[harness.cline] model',
    opts: [{ v: 'unset' }, { v: 'example-model' }], def: 'unset', show: c => c.harness === 'cline',
    effect: 'No default, on purpose: unset, dejima refuses to launch cline at all.' },
  { id: 'base_url', project: 'dejima', group: 'Agent', where: '~/.config/dejima/config', key: '[backend.self-hosted] base_url',
    opts: [{ v: 'http://10.0.0.10:11434', label: 'an address' }, { v: 'http://llm.example.lan:11434', label: 'a name' }],
    def: 'http://10.0.0.10:11434', show: c => c.backend === 'self-hosted',
    effect: 'An address is permitted as-is, no DNS. A name must already be approved, globally or by the project, and needs the resolver, so the session cannot seal.' },
  { id: 'proxy', project: 'dejima', group: 'Agent', where: '~/.config/dejima/config', key: '[credentials] proxy',
    opts: onOff, def: 'on', show: c => c.backend !== 'self-hosted',
    effect: 'off mounts the real credential file into the container. Only claude-code can run that way; cline refuses.' },
  { id: 'transport', project: 'dejima', group: 'Agent', where: '~/.config/dejima/config', key: '[credentials] transport',
    opts: [{ v: 'tls' }, { v: 'loopback' }], def: 'tls', show: c => c.backend !== 'self-hosted' && c.proxy === 'on',
    effect: 'How the harness reaches the proxy socket: a TLS terminator on :443, or plain HTTP on :18300. cline needs tls.' },

  { id: 'isolated', project: 'dejima', group: 'Launch', where: 'dejima launch flag', key: '--isolated', flag: true,
    opts: onOff, def: 'off',
    effect: 'No project: a throwaway /dejima/work, a fresh ~/shared, no forge, no [mounts], no audit.' },
  { id: 'keep', project: 'dejima', group: 'Launch', where: 'dejima launch flag', key: '--keep-records', flag: true,
    opts: onOff, def: 'off', show: c => c.isolated === 'on',
    effect: 'Keep the conversation log and epitaph for an isolated session.' },
  { id: 'drop', project: 'dejima', group: 'Launch', where: 'dejima launch flag', key: '--drop-domains', flag: true,
    opts: onOff, def: 'off',
    effect: 'Drops the built-in list, global approvals, and the forge. Keeps the model API and project approvals.' },
  { id: 'sealed', project: 'dejima', group: 'Launch', where: 'dejima launch flag', key: '--require-sealed', flag: true,
    opts: onOff, def: 'off',
    effect: 'No name may be permitted at all, so the resolver gets no upstream. Refuses to launch otherwise.' },

  { id: 'firewall', project: 'dejima', group: 'Network', where: '~/.config/dejima/config', key: '[core] firewall',
    opts: onOff, def: 'on', effect: 'off loads no rules: the session keeps its bridge network, unfiltered, with the host\'s reach.' },
  { id: 'allowed', project: 'dejima', group: 'Network', where: 'project file, approved on the host', key: '.dejima/allowed-domains',
    multi: true, opts: [{ v: 'pypi.org' }, { v: 'wiki.example.lan' }, { v: 'llm.example.lan' }], def: [],
    effect: 'Names the project asks for. Nothing is permitted until dejima-project approve. Not read by an isolated launch.' },
  { id: 'global', project: 'dejima', group: 'Network', where: 'dejima-allow --global, on the host', key: 'global approvals',
    multi: true, opts: [{ v: 'pypi.org' }, { v: 'wiki.example.lan' }, { v: 'llm.example.lan' }], def: [],
    effect: 'Names approved for every launch, isolated ones included. Dropped by --drop-domains.' },
  { id: 'internal', project: 'dejima', group: 'Network', where: '~/.config/dejima/config', key: '[core] internal_domains',
    opts: [{ v: 'unset' }, { v: 'wiki.example.lan' }], def: 'unset',
    effect: 'Lets a permitted name answer with a private address; without it, the launch\'s self-check refuses one that does. It never permits a name.' },
  { id: 'ghpush', project: 'dejima', group: 'Network', where: 'dejima launch flag', key: '--allow-github-push', flag: true,
    opts: onOff, def: 'off', effect: 'Opens port 22 to GitHub and lets the push guard pass github.com, even under local-only. Under --drop-domains the ranges are not fetched.' },

  { id: 'forge', project: 'dejima', group: 'Forge', where: '~/.config/dejima/config', key: '[core] forge',
    opts: [{ v: 'none' }, { v: 'gitea' }, { v: 'github' }], def: 'none',
    effect: 'Which forge the session may talk to, and which forge CLI it gets. Drawn with [forge.gitea] ssh_host, api, and token_file set, or [forge.github] push_token_file.' },
  { id: 'workflow', project: 'dejima', group: 'Forge', where: '~/.config/dejima/config', key: '[core] workflow',
    opts: [{ v: 'local-only' }, { v: 'branch-push' }, { v: 'worktree-pr' }], def: 'local-only',
    effect: 'local-only refuses every push. The others push branches, never main or master, and every workflow blocks merges.' },
  { id: 'ssh_key', project: 'dejima', group: 'Forge', where: '~/.config/dejima/config', key: '[identity.default] ssh_key',
    opts: [{ v: 'unset' }, { v: '~/.ssh/dejima_ed25519' }], def: 'unset',
    effect: 'A key for the session alone. Unset, a pushing workflow mounts your forwarded agent at /ssh-agent instead (drawn assuming one is running).' },

  { id: 'ro', project: 'dejima', group: 'Mounts', where: '~/.config/dejima/config', key: '[mounts] readonly',
    opts: [{ v: 'unset' }, { v: '/srv/datasets' }], def: 'unset', effect: 'Mounted at the same path, read-only.' },
  { id: 'rw', project: 'dejima', group: 'Mounts', where: '~/.config/dejima/config', key: '[mounts] read_write',
    opts: [{ v: 'unset' }, { v: '/home/alice/notes' }], def: 'unset',
    effect: 'Mounted at the same path, writable, and shared by every project.' },
  { id: 'rwpp', project: 'dejima', group: 'Mounts', where: '~/.config/dejima/config', key: '[mounts] read_write_per_project',
    opts: [{ v: 'unset' }, { v: '/home/alice/scratch' }], def: 'unset',
    effect: 'Writable at that path, backed by <path>/projects/<slug> so projects never share it.' },

  { id: 'loki', project: 'dejima', group: 'Records', where: '~/.config/dejima/config', key: '[logging] loki_url',
    opts: [{ v: 'unset' }, { v: 'http://loki.example.lan:3100' }], def: 'unset',
    effect: 'Ships every lookup and connection to Loki. Unset, nothing leaves.' },
  { id: 'conversation', project: 'dejima', group: 'Records', where: '~/.config/dejima/config', key: '[logging] conversation',
    opts: onOff, def: 'off', show: c => c.loki !== 'unset',
    effect: 'Also ships prompts and tool calls, from the host, where the session cannot stop it.' },
  { id: 'epitaph', project: 'dejima', group: 'Records', where: '~/.config/dejima/config', key: '[epitaph] enabled',
    opts: onOff, def: 'on', effect: 'Saves the compaction summaries host-side when the session closes.' },

  // remote access: [remote-access] in the same file, plus host setup
  { id: 'ra_doors', project: 'remote', group: 'Front doors', where: 'host setup', key: 'front doors', setup: true,
    opts: [{ v: 'web + ssh' }, { v: 'web' }, { v: 'ssh' }], def: 'web + ssh',
    effect: 'Web is nginx and ttyd; SSH is a phone key whose forced command is dejima-attach.' },
  { id: 'ra_ntfy', project: 'remote', group: 'Front doors', where: '~/.config/dejima/config', key: '[remote-access] ntfy_url',
    opts: [{ v: 'unset' }, { v: 'https://ntfy.example.lan:8443/dejima' }], def: 'unset',
    effect: 'Where dejima-notify-watch posts when a session finishes or needs input. Unset, the watcher will not start. A public ntfy server needs no devbox pinhole.' },
  { id: 'ra_base', project: 'remote', group: 'Front doors', where: '~/.config/dejima/config', key: '[remote-access] base_url',
    opts: [{ v: 'unset' }, { v: 'https://dejima.example.lan' }], def: 'unset',
    effect: 'Adds a tap-to-attach link to each push, whichever front doors exist.' },

  // devbox-hardener: Proxmox firewall built in the console, plus the guest bootstrap
  { id: 'dv_addr', project: 'devbox', group: 'Node firewall', where: 'dejima-devbox-bootstrap', key: 'static IP', setup: true,
    opts: [{ v: 'static' }, { v: 'dhcp' }], def: 'static',
    effect: 'DHCP needs rules 2a and 6a. A pinned address needs neither.' },
  { id: 'dv_6b', project: 'devbox', group: 'Node firewall', where: 'Proxmox security group', key: 'rule 6b (ntfy pinhole)', setup: true,
    opts: onOff, def: 'off',
    effect: 'Optional, outside the twelve base rules. notify-watch runs on the VM, so without 6b a push to a LAN ntfy is dropped as LAN traffic.' },

  // ci-hardener
  { id: 'ci_tiers', project: 'ci', group: 'Runners', where: 'dejima-ci-bootstrap --role', key: 'tiers', setup: true,
    opts: [{ v: 'both' }, { v: 'confined' }, { v: 'privileged' }], def: 'both',
    effect: 'One VM per tier. The tier decides whether jobs get a Docker socket.' },
  { id: 'ci_pools', project: 'ci', group: 'Runners', where: '/etc/dejima-ci/pools', key: 'pools',
    opts: [{ v: 'alice/proj', label: 'one repo' }, { v: 'alice/proj + bob', label: 'repo + owner' }], def: 'alice/proj',
    show: c => c.ci_tiers !== 'privileged',
    effect: 'Each pool gets its own bridge and address set: the union of what its repos declare.' },
  { id: 'ci_count', project: 'ci', group: 'Runners', where: 'dejima-ci-runners --count', key: '--count', setup: true,
    opts: [{ v: '1' }, { v: '3' }], def: '3', show: c => c.ci_tiers !== 'privileged',
    effect: 'Runners in one pool share its bridge, so their jobs can reach each other.' },

  // guard
  { id: 'gd_place', project: 'guard', group: 'Placement', where: 'your network', key: 'guard host', setup: true,
    opts: [{ v: 'admin subnet' }, { v: 'other segment' }], def: 'admin subnet',
    effect: 'Off the admin subnet, the devbox firewall needs rule 2b for the guard\'s one address.' },
  { id: 'gd_shape', project: 'guard', group: 'Placement', where: 'install', key: 'deployment', setup: true,
    opts: [{ v: 'systemd timer' }, { v: 'container' }], def: 'systemd timer',
    effect: 'A timer every 15 min with 60 s jitter, or dejima-guard-loop every DEJIMA_GUARD_INTERVAL=900.' },
  { id: 'gd_alert', project: 'guard', group: 'Alerts', where: '/etc/dejima-guard/config', key: 'alert route', setup: true,
    opts: [{ v: 'ntfy_url' }, { v: 'alert_command' }], def: 'ntfy_url',
    effect: 'ntfy on the guard\'s own topic, or a command that gets the alert on stdin.' },
  { id: 'gd_hb', project: 'guard', group: 'Alerts', where: '/etc/dejima-guard/config', key: 'heartbeat_url',
    opts: [{ v: 'unset' }, { v: 'https://kuma.example.lan/api/push/…' }], def: 'https://kuma.example.lan/api/push/…',
    effect: 'Pinged after each clean cycle. When it stops, the dead-man\'s switch fires.' },
  { id: 'gd_expect', project: 'guard', group: 'Alerts', where: 'dejima-guard expect', key: 'expect', setup: true,
    opts: [{ v: 'closed' }, { v: '2h' }], def: 'closed',
    effect: 'A maintenance window: changes are held, except watched paths and containment.' },

  // darner
  { id: 'dn_front', project: 'darner', group: 'Frontends', where: 'api.toml [tokens]', key: 'frontends',
    multi: true, opts: [{ v: 'maubot' }, { v: 'darner-web' }], def: ['maubot', 'darner-web'],
    effect: 'Each frontend has its own token and sees only the sessions it started.' },
  { id: 'dn_answers', project: 'darner', group: 'Launcher', where: 'darner-launch option', key: '--answers', flag: true,
    opts: onOff, def: 'off', effect: 'Lets a frontend type an answer into the session. Off, it says where to attach.' },
  { id: 'dn_ra', project: 'darner', group: 'Launcher', where: 'api.toml', key: 'remote_access_url',
    opts: [{ v: 'unset' }, { v: 'https://dejima.example.lan' }], def: 'unset', show: c => c.on.remote,
    effect: 'Each session links to its window in dejima\'s web front door.' },
  { id: 'dn_net', project: 'darner', group: 'Task', where: 'task keyword', key: 'network:',
    opts: [{ v: 'default' }, { v: 'named' }, { v: 'sealed' }], def: 'default',
    effect: 'named passes --drop-domains, sealed passes --require-sealed.' },
  { id: 'dn_harness', project: 'darner', group: 'Task', where: 'task keyword', key: 'harness:',
    opts: [{ v: 'default' }, { v: 'claude-code' }, { v: 'cline' }], def: 'default',
    effect: 'Overrides the launcher default, which falls back to dejima\'s [core] harness.' },
];

export const keyById = Object.fromEntries(KEYS.map(k => [k.id, k]));

export function keyName(k, c) { return typeof k.key === 'function' ? k.key(c) : k.key; }
export function keyOpts(k, c) { return typeof k.opts === 'function' ? k.opts(c) : k.opts; }
export function keyShown(k, c) { return c.on[k.project] !== false && (!k.show || k.show(c)); }

export function defaults() {
  const c = { on: { dejima: true, remote: false, devbox: false, ci: false, guard: false, darner: false } };
  for (const k of KEYS) c[k.id] = Array.isArray(k.def) ? [...k.def] : k.def;
  return c;
}

// Keep dependent values legal after a change, the way the UI offers them.
export function normalise(c) {
  const b = keyOpts(keyById.backend, c).map(o => o.v);
  if (!b.includes(c.backend)) c.backend = 'anthropic';
  if (c.on.guard) c.on.devbox = true;
  if (!c.on.remote) c.dn_ra = 'unset';
  return c;
}

// What dejima actually runs with once flags have had their say.
// Each override carries the reason a launch would print.
export function effective(c) {
  const e = { ...c, overrides: {} };
  const over = (id, v, why) => { if (e[id] !== v) { e.overrides[id] = why; e[id] = v; } };
  if (c.sealed === 'on') e.drop = 'on';
  if (c.isolated === 'on') {
    over('forge', 'none', '--isolated sets forge none');
    over('workflow', 'local-only', '--isolated sets local-only');
    for (const m of ['ro', 'rw', 'rwpp']) over(m, 'unset', '--isolated drops [mounts]');
    if (c.keep !== 'on') {
      over('epitaph', 'off', '--isolated keeps no epitaph without --keep-records');
      over('conversation', 'off', '--isolated keeps no conversation log without --keep-records');
    }
  }
  if (e.drop === 'on') {
    over('workflow', 'local-only', '--drop-domains forces local-only');
    if (e.forge !== 'none') e.forgeDropped = true;
  }
  if (e.backend === 'self-hosted') { e.proxy = 'n/a'; e.transport = 'n/a'; }
  if (e.loki === 'unset') e.conversation = 'off';
  e.selfHosted = e.backend === 'self-hosted';
  e.proxied = !e.selfHosted && e.proxy === 'on';
  e.apiHost = { unset: 'api.anthropic.com', anthropic: 'api.anthropic.com', 'anthropic-api-key': 'api.anthropic.com',
    openrouter: 'openrouter.ai', 'self-hosted': e.base_url.includes('llm.') ? 'llm.example.lan' : '10.0.0.10' }[e.backend];
  e.llmByName = e.selfHosted && e.base_url.includes('llm.');
  e.pushes = e.workflow !== 'local-only';
  // From the workflow, not from whether anything may be pushed to: local-only
  // blocks none, and --allow-github-push can still give it a push host.
  e.blocked = e.pushes ? ['main', 'master'] : [];
  // Where a push may go, and what signs it.
  e.pushHosts = [...(e.pushes && e.forge === 'gitea' ? ['git.example.lan'] : []),
    ...((e.pushes && e.forge === 'github') || e.ghpush === 'on' ? ['github.com'] : [])];
  e.agent = e.pushes && e.ssh_key === 'unset';
  return e;
}

// The names the resolver will forward, with the reason each is there.
export function permitted(e) {
  if (e.firewall === 'off') return [];
  const out = [];
  const add = (name, why, cls = 'open') => { if (!out.some(o => o.name === name)) out.push({ name, why, cls }); };
  const drop = e.drop === 'on';
  if (!drop) {
    add('github.com', 'built-in, 443 only', 'github');
    add('githubusercontent.com', 'built-in, 443 only', 'github');
    add('githubassets.com', 'built-in, 443 only', 'github');
    add('api.github.com', 'where GitHub\'s ranges are fetched from', 'github');
    add('registry.npmjs.org', 'built-in');
    add('release-assets.githubusercontent.com', 'built-in');
  }
  if (e.harness === 'claude-code') add('platform.claude.com', 'claude-code api_domains');
  if (!e.selfHosted && e.proxy === 'off') add(e.apiHost, 'proxy off: the API name joins the open list');
  if (e.llmByName && llmApproved(e)) add('llm.example.lan', 'self-hosted base_url, internal-exempt');
  if (!drop && e.forge === 'gitea') add('git.example.lan', 'configured forge, internal-exempt');
  if (!drop) for (const d of e.global) add(d, 'global approval');
  if (e.isolated !== 'on') for (const d of e.allowed) add(d, 'project approval');
  if (e.loki !== 'unset') add('loki.example.lan', 'Loki host, internal-exempt');
  return out;
}

// Names in the picture that answer with a private address, and the ones a
// launch exempts from refusing that without being told.
const PRIVATE = ['wiki.example.lan', 'llm.example.lan', 'git.example.lan', 'loki.example.lan'];
export function exempt(e) {
  const x = new Set(['git.example.lan', 'loki.example.lan']);
  if (e.internal !== 'unset') x.add(e.internal);
  if (e.llmByName) x.add('llm.example.lan');
  return x;
}

// cline's host check reads the approval stores, global and (outside --isolated)
// project, not --domains.
function llmApproved(e) { return e.global.includes('llm.example.lan') || (e.isolated !== 'on' && e.allowed.includes('llm.example.lan')); }

// The first thing dejima would refuse, in the order it checks. Each is an
// exit, so only one is ever printed.
export function refusal(e) {
  if (e.workflow === 'worktree-pr' && e.forge === 'none')
    return "workflow 'worktree-pr' requires the 'pr' capability, and [core] forge = none has none.";
  if (e.pushes && e.forge === 'none')
    return `[core] workflow = ${e.workflow} pushes, and [core] forge = none gives it nowhere to push.`;
  if (e.harness === 'cline') {
    if (e.cline_model === 'unset') return 'harness.cline: no model is configured. Cline has no default worth dejima choosing for you. Set [harness.cline] model.';
    if (e.backend === 'unset') return 'harness.cline: no [harness.cline] backend is set, so nothing says where the model is. There is deliberately no default.';
    if (!e.selfHosted) {
      if (e.proxy === 'off') return 'harness.cline: the proxy is off for this backend, and cline has no way to reach a proxied backend without it. Only claude-code can run with the real credential mounted.';
      if (e.transport === 'loopback') return 'harness.cline: [credentials] transport is loopback, and cline has no way to reach a proxied backend without the TLS terminator.';
    }
  }
  if (e.llmByName && !llmApproved(e))
    return `harness.cline: refusing [backend.self-hosted] base_url ${e.base_url}: llm.example.lan is not host-local and not approved${e.isolated === 'on' ? ' (an isolated launch reads global approvals only)' : ''}. dejima-allow --global or --project would let it in.`;
  if (e.sealed === 'on') {
    if (e.firewall === 'off') return '--require-sealed refuses a launch with [core] firewall = off.';
    if (e.harness === 'claude-code') return '--require-sealed: claude-code always permits platform.claude.com, so its resolver keeps an upstream.';
  }
  const p = permitted(e).map(x => x.name);
  if (e.firewall === 'on' && e.internal !== 'unset' && !p.includes(e.internal) && e.drop !== 'on')
    return `[core] internal_domains names ${e.internal}, which is not permitted. An exemption never permits; the filter stops the launch.`;
  if (e.firewall === 'on') {
    const x = exempt(e);
    const bad = p.filter(n => PRIVATE.includes(n) && !x.has(n));
    if (bad.length)
      return `The egress control for this session stopped before it was ready. The filter said: check 7: these permitted names are answered with an address inside a private network, and this policy refuses such answers: ${bad.map(n => `${n} (open/strict)`).join(' ')}. That is this configuration disagreeing with itself - list them in [core] internal_domains (or --internal-domain, for one launch) if pointing inside is intended, or remove them.`;
  }
  if (e.sealed === 'on' && p.length) return `--require-sealed: the session is not sealed. Still permitted: ${p.join(', ')}.`;
  return null;
}

// What a launch that goes ahead says along the way, and where it says it.
export function notes(e) {
  const n = [];
  const p = permitted(e).map(x => x.name);
  if (e.firewall === 'on' && e.internal !== 'unset' && !p.includes(e.internal) && e.drop === 'on')
    n.push(`Ignored, not refused: --drop-domains drops exemptions for names that are not permitted (${e.internal}). The note goes to the filter's log (docker logs), not your terminal.`);
  if (e.firewall === 'off') n.push('Nothing prints a warning: the banner shows firewall off, and the launch carries on.');
  return n;
}

export function refusals(e) { const r = refusal(e); return r ? [r] : []; }

export function sealedState(e) {
  return e.firewall === 'on' && permitted(e).length === 0;
}
