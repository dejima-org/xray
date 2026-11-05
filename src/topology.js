// derive(config) -> the picture: a containment tree of walls and the things
// inside them, plus the static links (mounts, sockets) between them.
import { effective, permitted, refusals, sealedState } from './config.js';

const box = (id, kind, label, children, o = {}) => ({ id, kind, label, children: children.filter(Boolean), ...o });
const leaf = (id, kind, label, o = {}) => ({ id, kind, label, ...o });
const info = (what, keys = [], facts = []) => ({ what, keys, facts });

export const RUN = '3f9a1c07e2b4d856';
export const SLUG = '-home-alice-proj';

export function derive(cfg) {
  const e = effective(cfg);
  const on = cfg.on;
  const refused = refusals(e);
  const sealed = sealedState(e);
  const names = permitted(e);
  const edges = [];
  const link = (from, to, kind, label) => edges.push({ id: `${from}>${to}`, from, to, kind, label });

  // ---- the dejima host: laptop, or the devbox VM ------------------------
  const iso = e.isolated === 'on';
  const fw = e.firewall === 'on';
  const files = [
    iso
      ? leaf('f-project', 'file', 'dejima_isolated-work-<run>', { sub: 'a volume, not a directory',
          info: info('A throwaway Docker volume mounted at /dejima/work. Removed when the session closes.', ['isolated']) })
      : leaf('f-project', 'file', '/home/alice/proj', { sub: 'the project',
          info: info('The project directory, mounted read-write at the same path. .git/hooks is laid over read-only.', ['isolated'],
            ['Changes here persist: this is the work.', 'The exit-time audit diffs .git/config, hooks, .mcp.json, .envrc and friends against a launch snapshot.']) }),
    leaf('f-share', 'file', iso ? 'shared/isolated/<fresh>' : `shared/projects/${SLUG}`, { sub: '[core] share_dir',
      info: info(iso
        ? 'A fresh directory for this one session, never reused. Removed at exit only if it is empty.'
        : 'One directory per project. Every session on this project mounts it at ~/shared, at the same time.',
        ['isolated'], ['Host path: ~/.local/share/dejima/shared/…', 'Inside the session it is always $HOME/shared.',
          'What lands here is hostile input to whatever reads it next: symlinks, FIFOs, huge sparse files.']) }),
    e.ro !== 'unset' && leaf('f-ro', 'file', e.ro, { sub: 'readonly', info: info('Mounted read-only at the same path.', ['ro']) }),
    e.rw !== 'unset' && leaf('f-rw', 'file', e.rw, { sub: 'read_write',
      info: info('Mounted writable at the same path. Every project that has it mounted shares it.', ['rw']) }),
    e.rwpp !== 'unset' && leaf('f-rwpp', 'file', `${e.rwpp}/projects/${SLUG}`, { sub: 'read_write_per_project',
      info: info(`Appears at ${e.rwpp} inside, but each project gets its own subdirectory.`, ['rwpp']) }),
    !e.selfHosted && leaf('f-cred', 'file', e.backend === 'anthropic' ? '~/.claude/.credentials.json'
      : e.backend === 'anthropic-api-key' ? '~/.claude.json' : '[backend.openrouter] credential_file', {
      sub: 'the real credential', tone: e.proxy === 'off' ? 'bad' : 'ok',
      info: info(e.proxy === 'off'
        ? 'With the proxy off this file is mounted into the container: the agent holds the real credential.'
        : 'Read only by the host-side credential proxy. The container gets a placeholder.',
        ['backend', 'proxy'], e.backend === 'anthropic' ? ['The proxy refreshes the OAuth token and writes the rotated one back here.'] : []) }),
    leaf('f-stores', 'store', 'approvals, audit, epitaphs', { sub: 'never mounted',
      info: info('~/.config/dejima and ~/.local/share/dejima: what the session cannot see, so it cannot approve its own domains or rewrite its audit.',
        ['allowed', 'epitaph'], ['A [mounts] entry overlapping any of these is refused, not warned.']) }),
  ];

  const filter = box('c-filter', 'container', 'filter container', [
    leaf('g-nft', 'gate', 'nftables', { sub: fw ? 'policy drop' : 'no rules loaded', tone: fw ? 'ok' : 'bad',
      info: info('The egress policy: one table, every chain policy drop. Anything not permitted gets a TCP reset, not a timeout.',
        ['firewall', 'ghpush', 'internal'],
        ['IPv6 is refused by the first rule.', 'Host addresses (the gateway and every address the host answers on) are open on no port by default.',
          'An answer for a non-exempt name that points at a private address is refused here as well as in dnsmasq.']) }),
    fw && leaf('s-dns', 'svc', 'dnsmasq 127.0.0.1:53', { sub: sealed ? 'no upstream: sealed' : `${names.length} name${names.length === 1 ? '' : 's'} forwarded`, tone: sealed ? 'ok' : undefined,
      info: info(sealed
        ? 'Sealed: no name is permitted, so dnsmasq has no server= lines and the ruleset has no upstream rule at all.'
        : 'The only resolver the session has. A permitted name is forwarded; anything else is answered locally and never leaves.',
        ['drop', 'sealed', 'allowed', 'internal'],
        names.length ? ['Forwarded: ' + names.map(n => `${n.name} (${n.why})`).join('; ')] : ['Forwarded: nothing.']) }),
    fw && leaf('s-logs', 'svc', 'connection + lookup loggers', { sub: e.loki !== 'unset' ? 'shipped to Loki' : 'kept local',
      info: info('ulogd2 and dns-lookup-log record every lookup and every new connection attempt, allowed or refused.', ['loki']) }),
  ], { sub: `dejima-filter-${RUN.slice(0, 6)}…`,
    info: info('Owns the network namespace and holds the only network privileges. Nothing the session runs executes here.',
      ['firewall'], ['cap_drop ALL; its only network capabilities are NET_ADMIN and NET_RAW.', 'Killing it leaves the session with loopback only.']) });

  const mounts = [
    leaf('m-project', 'mount', iso ? '/dejima/work' : '/home/alice/proj', { sub: 'rw', info: info('The work, writable.', ['isolated']) }),
    leaf('m-share', 'mount', '~/shared', { sub: 'rw', info: info('The hand-off directory: what the agent leaves for you, or for darner, to collect.', ['isolated']) }),
    e.ro !== 'unset' && leaf('m-ro', 'mount', e.ro, { sub: 'ro', info: info('Reads work; writes fail with EROFS.', ['ro']) }),
    e.rw !== 'unset' && leaf('m-rw', 'mount', e.rw, { sub: 'rw', info: info('Writes land on the host directory itself.', ['rw']) }),
    e.rwpp !== 'unset' && leaf('m-rwpp', 'mount', e.rwpp, { sub: 'rw, this project\'s', info: info('Writes land in this project\'s subdirectory.', ['rwpp']) }),
    e.proxied && leaf('m-sock', 'mount', 'proxy socket dir', { sub: 'ro',
      info: info('The directory holding the credential proxy\'s unix socket, mounted read-only. API traffic never touches the network.', ['proxy']) }),
    !e.selfHosted && e.proxy === 'off' && leaf('m-cred', 'mount', 'real credential', { sub: 'ro', tone: 'bad',
      info: info('[credentials] proxy = off: the kill switch. The agent can read and send the real credential.', ['proxy']) }),
    on.remote && leaf('m-notify', 'mount', '/run/dejima-notify', { sub: 'rw, empty markers',
      info: info('The session\'s only remote-access surface: a hook writes an empty done or waiting file here.', ['ra_ntfy']) }),
  ];

  const harnessFacts = e.harness === 'claude-code'
    ? ['Runs with --dangerously-skip-permissions: dejima is the boundary, not the prompt.',
      'Hooks: git-push-guard, merge-guard, deny-dangerous-bash, sandbox-context.']
    : ['Runs with --auto-approve. Hosts none of dejima\'s hooks; the PATH guards still apply.', 'providers.json is written fresh each launch.'];
  const session = box('c-session', 'container', 'session container', [
    leaf('s-harness', 'proc', e.harness, { sub: e.selfHosted ? `→ ${e.base_url.replace('http://', '')}` : `backend ${e.backend}`,
      info: info(`The agent. ${e.proxied ? 'It holds a placeholder credential: sandbox-credential-proxy-placeholder.' : ''}`,
        ['harness', 'backend'], harnessFacts) }),
    e.proxied && leaf('s-term', 'proc', e.transport === 'tls' ? 'TLS terminator :443' : 'forwarder :18300', {
      sub: e.transport === 'tls' ? `/etc/hosts: ${e.apiHost} → 127.0.0.1` : 'ANTHROPIC_BASE_URL',
      info: info(e.transport === 'tls'
        ? `${e.apiHost} resolves through /etc/hosts to 127.0.0.1. A self-signed cert for that name ends TLS here, and the bytes go down the socket.`
        : 'Plain HTTP on loopback, pointed at by ANTHROPIC_BASE_URL. Still ends at the same socket.', ['transport']) }),
    leaf('s-guards', 'proc', 'git + forge guards', { sub: e.pushes ? `push: ${e.forge} branches only` : 'every push refused',
      info: info('PATH shadows that fail fast. Not the boundary: the network is.', ['workflow', 'forge'],
        ['Refuses pushes to main or master, and to any host not in DEJIMA_PUSH_HOSTS.', 'Blocks merges and adds an agent-written marker to PR and issue bodies.']) }),
    box('c-mounts', 'group', 'mounts', mounts),
  ], { sub: 'joins the filter\'s namespace', tone: refused.length ? 'ghost' : undefined,
    info: info('Where the agent runs. It has no network namespace of its own and no network capability, so it cannot change the rules, even as root.',
      ['harness', 'isolated'], ['No sudo, no Docker socket, no ptrace, no IPv6.', 'Same uid, gid, and home path as you.']) });

  const netns = box('netns', 'netns', 'one network namespace', [session, filter], {
    info: info('network_mode: container:dejima-filter-…: both containers share one network stack and one loopback.', ['firewall']) });

  const dnSession = on.darner && box('c-dn', 'container', 'darner session', [
    leaf('dn-harness', 'proc', dnHarness(cfg, e), { sub: 'dejima --isolated',
      info: info('An anonymous isolated session darner-launch started in tmux. It never gets a project.', ['dn_harness', 'dn_net']) }),
    leaf('dn-share', 'mount', '~/shared', { sub: 'RESULT.md + .done', info: info('The agent writes RESULT.md, then touches .done.', []) }),
  ], { sub: 'filter not drawn',
    info: info('Every darner task is its own dejima --isolated launch, with its own filter container and network.', ['dn_net']) });

  const docker = box('docker', 'net', `dejima-run-${RUN.slice(0, 6)}…`, [
    leaf('bridge', 'svc', 'bridge gateway', { sub: '127.0.0.11 DNS',
      info: info('The Docker bridge. Its address is the session\'s default route and part of the host set the filter clamps.', [],
        ['Docker\'s embedded resolver at 127.0.0.11 exists only on a user-defined network, which is why each launch gets one.']) }),
    netns,
  ], { info: info('A user-defined bridge network, one per launch, removed at exit.', []) });
  const dnDocker = dnSession && box('dn-docker', 'net', 'dejima-run-8c41d2…', [dnSession], {
    info: info('The darner task\'s own per-launch network: a separate launch, a separate filter, a separate namespace.', []) });

  const procs = [
    leaf('p-launcher', 'proc', 'bin/dejima', { sub: 'the launcher',
      info: info('Builds the image, starts the proxy, the network, the filter, then the session, and tears all of it down on exit.', []) }),
    e.proxied && leaf('p-proxy', 'proc', 'credential proxy', { sub: `→ ${e.apiHost}`,
      info: info('A host process on a per-session unix socket. Swaps the placeholder for the real credential and connects upstream from the host.',
        ['proxy', 'backend'], ['Errors come back as a dejima-written 502, so provider bodies stay on the host.']) }),
    e.conversation === 'on' && leaf('p-shipper', 'proc', 'conversation shipper', { sub: 'host side',
      info: info('Ships prompts and tool calls from the host, where the session cannot kill its own oversight log.', ['conversation']) }),
    on.remote && e.ra_ntfy !== 'unset' && leaf('p-notify', 'proc', 'dejima-notify-watch', { sub: 'user unit',
      info: info('Watches the marker directories and posts to ntfy. Runs on the host, so the session\'s allowlist never sees this traffic.', ['ra_ntfy']) }),
    nginxNeeded(cfg) && leaf('p-nginx', 'proc', 'nginx 10.0.0.24:443', { sub: 'TLS + auth',
      info: info('Binds one LAN address, never 0.0.0.0 or a Docker bridge: a proxy a sandbox can reach is a full escape.', ['ra_doors'],
        ['Auth on every server block; the default_server rejects the TLS handshake.', 'Host $http_host, so ttyd\'s --check-origin works.']) }),
    on.remote && cfg.ra_doors !== 'ssh' && leaf('p-ttyd', 'proc', 'ttyd 127.0.0.1:7681', { sub: '--check-origin',
      info: info('Loopback only, hardcoded. Runs dejima-attach for each WebSocket. No credential of its own: nginx is the gate.', ['ra_doors']) }),
    on.remote && cfg.ra_doors !== 'web' && leaf('p-sshd', 'proc', 'sshd :22', { sub: 'phone key: forced command',
      info: info('The phone key is restrict,pty,command="…/dejima-attach": a picker, nothing else.', ['ra_doors']) }),
    on.remote && leaf('p-attach', 'proc', 'dejima-attach → tmux', { sub: 'picker',
      info: info('Validates the 16-hex run id, opens a throwaway grouped tmux session on that window.', [],
        ['That is a host shell, one prefix key away. Both doors are as strong as the auth in front of them.']) }),
    on.darner && leaf('p-dn-launch', 'proc', 'darner-launch', { sub: 'ssh forced command',
      info: info('Runs dejima --isolated in a tmux window per task and reports status. A fixed command grammar; anything else is refused.', ['dn_answers']) }),
    on.devbox && leaf('p-audit', 'proc', 'dejima-devbox-audit', { sub: 'reach, hourly',
      info: info('Probes the gateway on 443, 80, and 22 and expects silence, with the forge as a positive control.', [],
        ['PASS needs every probe to time out and the positive control to succeed. Anything answering is FAIL.', 'The IPv6 half fails on any neighbour answering ff02::1, or any global or ULA address.']) }),
    on.guard && leaf('p-guardshell', 'proc', 'dejima-guard-shell', { sub: 'forced command',
      info: info('Allows exactly two commands for the guard\'s key: drift --state and reach. Anything else exits 64.', []) }),
  ];

  const hostKids = [
    box('host-files', 'group', 'host files', files),
    box('nets', 'group', '', [docker, dnDocker]),
    box('host-procs', 'group', 'host processes', procs),
  ];
  const hostLabel = on.devbox ? 'devbox VM' : 'your laptop';
  const dejimaHost = box('dejima-host', 'host', 'dejima host', hostKids, {
    sub: on.devbox ? 'Debian, long-lived, never rolled back on a schedule' : 'your own user, your own home directory',
    refused,
    info: info(on.devbox
      ? 'dejima runs here as it would on a laptop. The difference is the wall around this VM, enforced by the Proxmox node.'
      : 'Below the container is your home directory, and dejima has nothing to say about it: a container escape lands here with your reach.',
      ['harness'], []) });

  // ---- machines ---------------------------------------------------------
  const laptop = box('laptop', 'machine', 'your laptop', on.devbox
    ? [leaf('lt-ssh', 'proc', 'ssh client', { sub: 'admin subnet', info: info('You, administering the devbox over SSH: node rule 1.', []) })]
    : [dejimaHost], { info: info(on.devbox ? 'dejima has moved to the devbox VM.' : 'dejima and its containers, on the machine you work on.', []) });

  const vms = [];
  if (on.devbox) vms.push(box('vm-devbox', 'vm', hostLabel, [
    leaf('fw-devbox', 'gate', 'node firewall', { sub: 'dejima-devbox-hardener', wall: true,
      info: info('The Proxmox security group on this VM\'s tap device. The guest cannot reach it, even as root.', ['dv_addr', 'dv_6b'],
        devboxRules(cfg).map(r => `${r.n}  ${r.dir} ${r.act} ${r.what}`)) }),
    dejimaHost,
  ], { info: info('4 cores, x86-64-v3 (Cline needs AVX2), 16 GB, 128 GB. One person\'s work per devbox.', []) }));

  if (on.ci && cfg.ci_tiers !== 'privileged') vms.push(ciConfined(cfg));
  if (on.ci && cfg.ci_tiers !== 'confined') vms.push(box('vm-ci-p', 'vm', 'privileged runner VM', [
    leaf('fw-ci-p', 'gate', 'node firewall', { sub: 'the only boundary', wall: true,
      info: info('The same security group as the confined VM. For this tier it is the whole boundary, with the weekly rollback.', [], ciRules()) }),
    leaf('cip-runner', 'proc', 'act_runner ×1', { sub: 'label dejima-privileged',
      info: info('Exactly one runner. container.network = host, docker_host = "": jobs get the socket.', ['ci_tiers']) }),
    leaf('cip-sock', 'svc', 'docker.sock', { sub: 'mounted into jobs', tone: 'warn',
      info: info('Root-equivalent. Needed for image builds and dejima\'s runtime.bats.', []) }),
    leaf('cip-job', 'proc', 'job', { sub: 'host netns, can run docker',
      info: info('No in-VM allowlist or firewall, on purpose: a job holding the socket could flush them, and a host that looks filtered is worse than one that honestly is not.', ['ci_tiers'],
        ['Reaches the internet, not your network.']) }),
  ], { sub: 'no internal firewall', info: info('Host hardening and one runner. install.sh is not run here.', ['ci_tiers']) }));

  const pveKids = [
    ...vms,
    box('pve-host', 'group', 'node', [
      on.devbox && leaf('pve-log', 'file', 'pve-firewall.log', { sub: 'drops logged at info',
        info: info('Rules 7-12 log here, written by the hypervisor out of the guest\'s reach. On a healthy devbox it is quiet; a burst is the loudest signal a compromise makes.', [],
          ['Nothing in either repo reads it.']) }),
      on.ci && leaf('pve-cron', 'proc', 'rollback cron', { sub: 'Sundays 04:00',
        info: info('qm rollback <vmid> clean on every runner VM. The devbox is never rolled back on a schedule.', []) }),
    ]),
  ];
  const pve = (on.ci || on.devbox) && box('pve', 'machine', 'Proxmox node', pveKids, {
    info: info('Holds the boundary: firewall rules on each VM\'s tap device, outside every guest.', [],
      ['Datacenter firewall, VM firewall, and the NIC firewall checkbox must all be on, or nothing is enforced and it looks like it works.']) });

  const guardHost = on.guard && box('guard', 'machine', 'guard host', [
    leaf('gd-cycle', 'proc', cfg.gd_shape === 'container' ? 'dejima-guard-loop' : 'dejima-guard.timer', { sub: 'every 15 min',
      info: info('Runs dejima-guard check: collect over SSH, diff against its own baseline, alert or heartbeat.', ['gd_shape', 'gd_expect']) }),
    leaf('gd-baseline', 'store', 'baseline', { sub: 'kept off the devbox',
      info: info('Root on the devbox can rewrite the local baseline. It cannot reach this one.', []) }),
  ], { sub: cfg.gd_place, info: info('Any always-on machine that is not the devbox: a NAS, a Pi, an existing VM. Listens on nothing.', ['gd_place']) });

  const phone = (on.remote || (on.darner && cfg.dn_front.length) || (on.guard && cfg.gd_alert === 'ntfy_url')) && box('phone', 'machine', 'phone', [
    on.remote && cfg.ra_doors !== 'ssh' && leaf('ph-web', 'proc', 'browser', { sub: 'web front door', info: info('The touch terminal page served by ttyd, behind nginx.', ['ra_doors']) }),
    on.remote && cfg.ra_doors !== 'web' && leaf('ph-ssh', 'proc', 'SSH app', { sub: 'phone key', info: info('A dedicated key that can only reach the picker. No SFTP, no forwarding.', ['ra_doors']) }),
    ((on.remote && cfg.ra_ntfy !== 'unset') || (on.guard && cfg.gd_alert === 'ntfy_url')) && leaf('ph-ntfy', 'proc', 'ntfy app', { sub: 'pushes', info: info('Subscribed read-only.', ['ra_ntfy']) }),
    on.darner && cfg.dn_front.includes('maubot') && leaf('ph-matrix', 'proc', 'Matrix client', { sub: 'talks to the bot', info: info('Mention the bot with a task.', ['dn_front']) }),
    on.darner && cfg.dn_front.includes('darner-web') && !(on.remote && cfg.ra_doors !== 'ssh') && leaf('ph-web', 'proc', 'browser', { sub: 'darner-web', info: info('darner-web, on its own origin.', ['dn_front']) }),
  ], { sub: 'on the LAN or a VPN', info: info('Where remote access is actually driven from.', []) });

  const darnerHost = on.darner && box('darner', 'machine', 'darner host', [
    cfg.dn_front.includes('darner-web') && leaf('dn-proxy', 'gate', 'auth proxy', { sub: 'VPN, Basic, mTLS…',
      info: info('darner-web has no login of its own. Whatever authenticates here is the whole gate.', ['dn_front']) }),
    cfg.dn_front.includes('darner-web') && leaf('p-dn-web', 'proc', 'darner-web :8081', { sub: 'stores nothing',
      info: info('Its own origin, never a path on the remote-access host. CSRF header plus Origin checks.', ['dn_front']) }),
    leaf('p-dn-api', 'proc', 'darner-api :8080', { sub: 'polls every 30 s',
      info: info('The only thing frontends talk to. A bearer token per frontend, SQLite for open tasks, and an ssh key locked to darner-launch.', ['dn_front'],
        ['No per-user permissions: anyone a frontend lets in can use every harness and backend on the dejima host.']) }),
  ], { info: info('darner-api and darner-web, under compose. It reaches the launcher over SSH with a forced-command key, whether on one machine or across two.', []) });

  const maubot = on.darner && cfg.dn_front.includes('maubot') && box('maubot', 'machine', 'maubot server', [
    leaf('mb-bot', 'proc', 'dragonlet plugin', { sub: 'polls /v1/events',
      info: info('Matrix ID allowlist plus its own bearer token. Posts results as notices and the zip as a file.', ['dn_front']) }),
  ], { info: info('Any maubot instance that can reach darner-api.', []) });

  // ---- the LAN and the internet -----------------------------------------
  const needsForge = e.forge === 'gitea' || on.ci || on.devbox;
  const usesWiki = e.allowed.includes('wiki.example.lan') || e.internal !== 'unset';
  const lanSvcs = box('lan-svcs', 'group', 'LAN services', [
    leaf('lan-router', 'svc', 'router 10.0.0.1', { sub: 'default gateway', info: info('Where traffic leaves for the internet.', []) }),
    leaf('lan-resolver', 'svc', 'resolver 10.0.0.53', { sub: 'LAN DNS', info: info('Resolves internal names like git.example.lan.', []) }),
    needsForge && leaf('lan-forge', 'svc', 'git.example.lan', { sub: 'forge, 10.0.0.20',
      info: info('Gitea. The hardeners leave a pinhole to it on 443 (and 22 for the devbox).', ['forge']) }),
    e.selfHosted && leaf('lan-llm', 'svc', e.llmByName ? 'llm.example.lan' : '10.0.0.10:11434', { sub: 'self-hosted model',
      info: info('No credential, so no proxy: the harness connects straight through nftables.', ['backend', 'base_url']) }),
    usesWiki && leaf('lan-wiki', 'svc', 'wiki.example.lan', { sub: 'internal, 10.0.0.30',
      info: info('A name that answers with a private address.', ['allowed', 'internal']) }),
    leaf('lan-nas', 'svc', 'NAS 10.0.0.40', { sub: 'everything else', info: info('Stands in for the rest of your network: what an escape would go looking for.', []) }),
    ((on.remote && cfg.ra_ntfy !== 'unset') || (on.guard && cfg.gd_alert === 'ntfy_url')) && leaf('lan-ntfy', 'svc', 'ntfy :8443', { sub: '10.0.0.50',
      info: info('A dedicated ntfy-only listener. If it shared the reverse proxy on 443, a pinhole to it would open every vhost behind that proxy.', ['ra_ntfy', 'dv_6b']) }),
    e.loki !== 'unset' && leaf('lan-loki', 'svc', 'loki.example.lan', { sub: '10.0.0.60', info: info('Receives dejima-dns, dejima-net, and dejima-conversation streams.', ['loki']) }),
    on.guard && cfg.gd_hb !== 'unset' && leaf('lan-kuma', 'svc', 'Uptime Kuma', { sub: 'push monitor, 1200 s',
      info: info('Fires when the guard\'s heartbeat stops: a dead guard is an alert too.', ['gd_hb']) }),
  ]);

  const lan = box('lan', 'zone', 'your LAN', [
    lanSvcs,
    box('lan-main', 'group', '', [
      box('machines', 'group', '', [laptop, pve]),
      box('clients', 'group', '', [phone, guardHost, darnerHost, maubot]),
    ]),
  ], { sub: '10.0.0.0/24 (example)', info: info('Private address space: what both hardeners fence the devbox and the runners out of.', []) });

  const internet = box('internet', 'zone', 'the internet', [
    !e.selfHosted && e.backend !== 'openrouter' && leaf('net-api', 'svc', 'api.anthropic.com', { sub: 'model API', info: info('Reached by the host-side proxy, not by the session.', ['backend']) }),
    e.backend === 'openrouter' && leaf('net-api', 'svc', 'openrouter.ai', { sub: 'model API', info: info('Reached by the host-side proxy, not by the session.', ['backend']) }),
    e.harness === 'claude-code' && leaf('net-platform', 'svc', 'platform.claude.com', { sub: 'claude-code api_domains', info: info('Always permitted for claude-code. This is why claude-code cannot seal.', ['harness', 'sealed']) }),
    leaf('net-npm', 'svc', 'registry.npmjs.org', { sub: 'built-in', info: info('On the built-in list; dropped by --drop-domains.', ['drop']) }),
    leaf('net-pypi', 'svc', 'pypi.org', { sub: 'needs approval', info: info('Reachable once the project declares it and you approve it.', ['allowed']) }),
    leaf('net-github', 'svc', 'github.com', { sub: '443 only by default', info: info('GitHub\'s ranges come from api.github.com/meta. Port 22 opens only with --allow-github-push or forge = github with a pushing workflow.', ['ghpush', 'forge']) }),
    leaf('net-unlisted', 'svc', 'example.net', { sub: 'not on any list', info: info('Any site nobody approved.', []) }),
    on.darner && cfg.dn_front.includes('maubot') && leaf('net-matrix', 'svc', 'matrix.example.org', { sub: 'homeserver', info: info('Your Matrix homeserver.', []) }),
  ], { info: info('Public IPv4. Both hardeners leave it open on purpose: the boundary they draw is around your LAN.', []) });

  const root = box('world', 'world', '', [internet, lan]);
  markOwners(root);
  // ---- static links -----------------------------------------------------
  link('f-project', 'm-project', 'rw');
  link('f-share', 'm-share', 'rw');
  if (e.ro !== 'unset') link('f-ro', 'm-ro', 'ro');
  if (e.rw !== 'unset') link('f-rw', 'm-rw', 'rw');
  if (e.rwpp !== 'unset') link('f-rwpp', 'm-rwpp', 'rw');
  if (e.proxied) { link('m-sock', 'p-proxy', 'socket'); link('f-cred', 'p-proxy', 'reads'); }
  if (!e.selfHosted && e.proxy === 'off') link('f-cred', 'm-cred', 'bad');
  if (on.remote && cfg.ra_ntfy !== 'unset') link('m-notify', 'p-notify', 'rw');
  return { root, edges, e, refused, sealed, names };
}

// Who a thing belongs to, so dejima's own parts stand out from the systems
// they run on and from everything else on the network.
const OURS = new Set(['docker', 'dn-docker', 'netns', 'c-filter', 'g-nft', 's-dns', 's-logs', 'c-session', 's-term', 's-guards', 'c-dn',
  'f-stores', 'p-launcher', 'p-proxy', 'p-shipper', 'p-notify', 'p-attach', 'p-dn-launch', 'p-dn-api', 'p-dn-web', 'mb-bot',
  'p-audit', 'p-guardshell', 'fw-devbox', 'fw-ci-c', 'fw-ci-p', 'ci-timer', 'ci-dns', 'ci-fwd', 'pve-cron', 'gd-cycle', 'gd-baseline']);
function markOwners(n) {
  n.own = OURS.has(n.id) ? 'ours' : /^(net|lan|ph)-|^(internet|lan)$/.test(n.id) ? 'ext' : 'sys';
  for (const c of n.children || []) markOwners(c);
}

function dnHarness(cfg, e) { return cfg.dn_harness === 'default' ? e.harness : cfg.dn_harness; }
function nginxNeeded(cfg) { return cfg.on.remote && cfg.ra_doors !== 'ssh'; }

function ciConfined(cfg) {
  const pools = cfg.ci_pools === 'alice/proj' ? [['1', 'alice/proj', 'repo']] : [['1', 'alice/proj', 'repo'], ['2', 'bob', 'owner']];
  const n = +cfg.ci_count;
  return box('vm-ci-c', 'vm', 'confined runner VM', [
    leaf('fw-ci-c', 'gate', 'node firewall', { sub: 'dejima-ci-hardener', wall: true,
      info: info('Defence in depth for this tier: the in-VM rules are the first boundary.', [], ciRules()) }),
    box('ci-ctl', 'group', '', [
      leaf('ci-timer', 'proc', 'dejima-ci-allowlist', { sub: 'every 10 min',
        info: info('GETs .dejima/allowed-domains?ref=main from the forge API for each trusted repo, never from a checkout. Any failure keeps the last good list.', ['ci_pools'],
          ['An empty result is refused; the render must pass dnsmasq --test.', 'Not per job: jobs see whatever was rendered last.']) }),
      leaf('ci-dns', 'svc', 'dnsmasq on dejima-ci0', { sub: 'refuses unlisted names',
        info: info('One resolver for every pool. Every job can resolve every allowlisted name; it can only connect to its own pool\'s set.', ['ci_pools']) }),
      leaf('ci-fwd', 'gate', 'DEJIMA-CI-FWD', { sub: 'tcp 80/443 to the set',
        info: info('Per bridge: established, then 80 and 443 to the pool\'s set or the base set, then REJECT. All IPv6 is rejected.', ['ci_pools']) }),
    ]),
    ...pools.map(([id, scope, kind]) => box(`pool-${id}`, 'net', `pool ${id}: ${scope}`, [
      ...Array.from({ length: n }, (_, i) => leaf(`r${id}-${i + 1}`, 'proc', `act_runner ${i + 1}`, { sub: 'capacity 1',
        info: info(`Registered to ${scope} (${kind} scope). The registration scope is the real boundary, not the label.`, ['ci_count']) })),
      leaf(`job-${id}`, 'proc', 'job', { sub: `dejima-ci${id}, ci-allow-${id}`,
        info: info('No Docker socket, cap drops, --dns at the gateway. Reaches 80/443 on its pool\'s names and the base names only.', ['ci_pools']) }),
    ], { sub: kind === 'owner' ? 'every repo bob owns' : 'one repo',
      info: info(`Bridge dejima-ci${id}, address set ci-allow-${id}: the union of .dejima/allowed-domains on main across ${kind === 'owner' ? 'all of bob\'s repos' : 'alice/proj'}.`,
        ['ci_pools', 'ci_count'], n > 1 ? ['Runners in one pool share the bridge: concurrent jobs can reach each other.'] : []) })),
  ], { sub: 'label dejima-confined', info: info('install.sh adds the job network, the resolver, the sets, and the firewall.', ['ci_tiers']) });
}

export function devboxRules(cfg) {
  const r = [
    { n: '1', dir: 'IN', act: 'ACCEPT', what: 'tcp/22 from the admin subnet' },
    { n: '2', dir: 'IN', act: 'ACCEPT', what: 'tcp/<front door> from the front-door subnet' },
    cfg.dv_addr === 'dhcp' && { n: '2a', dir: 'IN', act: 'ACCEPT', what: 'udp/68 (DHCP)' },
    cfg.on.guard && cfg.gd_place === 'other segment' && { n: '2b', dir: 'IN', act: 'ACCEPT', what: 'tcp/22 from the guard' },
    { n: '3', dir: 'OUT', act: 'ACCEPT', what: 'tcp/443 to the forge' },
    { n: '4', dir: 'OUT', act: 'ACCEPT', what: 'tcp/22 to the forge' },
    { n: '5-6', dir: 'OUT', act: 'ACCEPT', what: 'udp+tcp/53 to the resolver' },
    cfg.dv_addr === 'dhcp' && { n: '6a', dir: 'OUT', act: 'ACCEPT', what: 'udp/67 (DHCP)' },
    cfg.dv_6b === 'on' && { n: '6b', dir: 'OUT', act: 'ACCEPT', what: 'tcp/8443 to ntfy' },
    { n: '7-9', dir: 'OUT', act: 'DROP', what: '10/8, 172.16/12, 192.168/16 (logged)' },
    { n: '10', dir: 'OUT', act: 'DROP', what: '169.254/16 (logged)' },
    { n: '11', dir: 'OUT', act: 'DROP', what: '100.64/10 (logged)' },
    { n: '12', dir: 'OUT', act: 'DROP', what: '::/0, all IPv6 (logged)' },
    { n: 'policy', dir: 'IN', act: 'DROP', what: 'everything else inbound' },
  ];
  return r.filter(Boolean);
}

export function ciRules() {
  return ['1  IN ACCEPT tcp/22 from the management IP', '2  OUT ACCEPT tcp/443 to the forge', '3-4  OUT ACCEPT udp+tcp/53 to the resolver',
    '5-7  OUT DROP 10/8, 172.16/12, 192.168/16', '8  OUT DROP 169.254/16', '9  OUT DROP 100.64/10', '10  OUT DROP ::/0',
    '1a/4a  udp/68 in, udp/67 out: only with DHCP', 'policy  IN DROP, OUT ACCEPT: the public internet stays open'];
}
