// scenarios(cfg, derived) -> what the user can play. Each step moves one
// packet along `path` (node ids) and ends with a verdict:
//   ok       allowed, delivered
//   refused  stopped at the last node of the path
//   warn     delivered, and it should worry you
//   info     a fact about this moment, nothing moves through a wall
// `gone` fades nodes for the rest of the run; `kept` marks what survives.

import { effective, normalise, refusals } from './config.js';

const step = (path, verdict, title, detail, keys = [], o = {}) => ({ path, verdict, title, detail, keys, ...o });

export function scenarios(cfg, d) {
  const { e, refused } = d;
  const on = cfg.on;
  const dv = on.devbox;
  const fw = e.firewall === 'on';
  const nodeFw = dv ? ['fw-devbox'] : [];
  const out = dest => ['bridge', ...nodeFw, 'lan-router', dest];
  const list = [];
  const add = (project, id, title, steps) => list.push({ project, id, title, steps: steps.filter(Boolean) });
  const launchBlocked = refused.length
    ? [step(['p-launcher'], 'refused', 'dejima refuses to launch', refused.join(' '), ['sealed', 'internal', 'workflow'])]
    : null;
  const guard = s => launchBlocked || s;

  // ---- dejima -----------------------------------------------------------
  add('dejima', 'launch', 'Launch a session', [
    step(['p-launcher', 'f-stores'], 'info', 'Read config and approvals',
      'Flags beat ~/.config/dejima/config, which beats the pinned defaults. Approved domains and dependencies are unioned: built-in, then global, then project.',
      ['isolated', 'allowed']),
    ...(launchBlocked || [
      e.proxied && step(['p-launcher', 'p-proxy'], 'info', 'Start the credential proxy',
        `A host process on a fresh unix socket, holding the ${e.backend} credential. The container will only ever see a placeholder.`, ['proxy', 'backend']),
      step(['p-launcher', 'docker'], 'info', 'Create the network', 'dejima-run-<run id>: a user-defined bridge, one per launch.', []),
      step(['p-launcher', 'c-filter'], fw ? 'ok' : 'warn', fw ? 'Start the filter and check it' : 'Start the filter, with nothing in it',
        fw ? `nftables loads, dnsmasq starts with ${d.names.length} forwarded names, then a self-check resolves each one, asserts IPv6 is refused and AAAA stripped, and that port 22 is refused unless granted.${d.sealed ? ' The ready record says resolver_upstream: false, so the launch prints S E A L E D.' : ''}`
          : '[core] firewall = off: firewall-up.sh exits before loading a rule, and resolv.conf is left alone.', ['firewall', 'drop', 'sealed']),
      step(['p-launcher', 'c-session'], 'ok', 'Start the session inside it',
        'The session joins the filter\'s network namespace. Its entrypoint points resolv.conf at 127.0.0.1, installs the guards, drops every capability, and runs the harness.',
        ['harness']),
    ]),
  ]);

  // Ask the model
  add('dejima', 'api', 'Ask the model', guard(e.selfHosted ? [
    e.llmByName
      ? step(['s-harness', 's-dns', 'bridge', ...nodeFw, 'lan-resolver'], 'ok', 'Look up llm.example.lan',
          'A self-hosted base_url name is permitted and internal-exempt automatically, so its private answer is accepted. It also means the resolver keeps an upstream.', ['base_url'])
      : step(['s-harness', 'g-nft'], fw ? 'ok' : 'warn', '10.0.0.10 is permitted by address',
          'An IPv4 base_url goes straight into the literal set. No DNS, so no answer to check, and internal_domains does not apply.', ['base_url']),
    step(['s-harness', 'g-nft', 'bridge', ...nodeFw, 'lan-llm'], dv ? 'refused' : 'ok', dv ? 'The node firewall drops it' : 'Straight to the model',
      dv ? 'dejima allows it, but the devbox may only reach the forge and the resolver on the LAN. Rules 7-9 drop 10/8. A LAN model needs its own pinhole above the DROPs.'
        : 'No credential exists, so there is no proxy and no placeholder. The request crosses nftables like any other permitted connection.', ['backend']),
  ] : e.proxy === 'off' ? [
    step(['s-harness', 'm-cred'], 'warn', 'Read the real credential', 'With [credentials] proxy = off, the credential file is mounted into the container. The agent can read it, and send it anywhere it can reach.', ['proxy']),
    step(['s-harness', 's-dns'], 'ok', `Look up ${e.apiHost}`, 'The API name joins the open list when the proxy is off.', ['proxy']),
    step(['s-harness', 'g-nft', ...out('net-api')], 'warn', 'Straight to the API, with the real key', 'Through nftables, through the host, out. Nothing on the way can tell your key from a copy.', ['proxy']),
  ] : [
    step(['s-harness', 's-term'], 'ok', `${e.apiHost} resolves to 127.0.0.1`,
      e.transport === 'tls' ? '/etc/hosts maps it to loopback, so no DNS query is made. A terminator with a cert dejima made for this session ends TLS there.'
        : 'ANTHROPIC_BASE_URL points at a plain-HTTP forwarder on 127.0.0.1:18300.', ['transport']),
    step(['s-term', 'm-sock', 'p-proxy'], 'ok', 'Down the socket, not the network',
      'A unix socket in a read-only mounted directory. API traffic never crosses nftables, and the API name is not on the allowlist: resolving it by DNS returns nothing.', ['proxy']),
    step(['p-proxy', 'f-cred'], 'info', 'Swap in the real credential',
      e.backend === 'anthropic' ? 'The proxy replaces the placeholder Bearer token with your OAuth token, refreshing it when it expires.' : 'The proxy replaces the placeholder key with the real one.', ['backend']),
    step(['p-proxy', ...nodeFw, 'lan-router', 'net-api'], 'ok', 'Upstream, from the host',
      dv ? 'The proxy runs on the devbox, outside the container. The node allows public IPv4 by policy.' : 'The proxy connects from your laptop\'s own network.', ['backend']),
  ]));

  // Install a package
  const npmDropped = e.drop === 'on';
  add('dejima', 'npm', 'Install an npm package', guard(!fw ? [
    step(['s-harness', ...out('net-npm')], 'warn', 'No filter at all', 'With [core] firewall = off the session reaches whatever the host can.', ['firewall']),
  ] : [
    step(['s-harness', 's-dns'], npmDropped ? 'refused' : 'ok', 'Look up registry.npmjs.org',
      npmDropped ? (d.sealed ? 'Sealed: dnsmasq has no upstream to forward anything to.' : '--drop-domains dropped the built-in list. The name is answered locally and never leaves.')
        : 'On the built-in list, so it is forwarded.', ['drop', 'sealed']),
    !npmDropped && step(['s-dns', 'bridge', ...nodeFw, 'lan-resolver'], 'ok', 'Forwarded upstream',
      `To Docker's resolver at 127.0.0.11, then your resolver${dv ? ', through node rules 5-6' : ''}. AAAA answers are stripped; the addresses go into an nftables set for an hour.`, []),
    !npmDropped && step(['s-harness', 'g-nft', ...out('net-npm')], 'ok', 'Connect on 443', 'The address is in the set, so nftables accepts it.', []),
  ]));

  // A declared name
  const pypiOk = e.allowed.includes('pypi.org') && e.isolated !== 'on';
  add('dejima', 'pypi', 'Reach a name the project declares', guard(!fw ? [
    step(['s-harness', ...out('net-pypi')], 'warn', 'No filter at all', 'Everything is reachable with the firewall off.', ['firewall']),
  ] : [
    step(['s-harness', 's-dns'], pypiOk && !d.sealed ? 'ok' : 'refused', 'Look up pypi.org',
      pypiOk ? 'Declared in .dejima/allowed-domains and approved on the host, so it is permitted, even under --drop-domains.'
        : e.isolated === 'on' ? 'An isolated session has no project, so project approvals do not apply. dejima --isolated --domains FILE would grant it.'
          : 'Not permitted. The project can declare it in .dejima/allowed-domains, but nothing changes until you run dejima-project approve on the host. dejima-allow --container grants it to this session only.',
      ['allowed', 'isolated']),
    pypiOk && step(['s-harness', 'g-nft', ...out('net-pypi')], 'ok', 'Connect', 'In the set, accepted.', ['allowed']),
  ]));

  // Unlisted
  add('dejima', 'unlisted', 'Reach a site nobody approved', guard(!fw ? [
    step(['s-harness', ...out('net-unlisted')], 'warn', 'Delivered', 'With the firewall off, nothing stops it.', ['firewall']),
  ] : [
    step(['s-harness', 's-dns'], 'refused', 'Look up example.net', 'Answered locally by address=/#/, never forwarded, and logged as refused.', []),
    step(['s-harness', 'g-nft'], 'refused', 'Try its address directly', '203.0.113.7 is in no set, so nftables answers with a TCP reset. It fails at once, not after a timeout.', []),
    step(['s-harness', 'g-nft'], 'refused', 'Try the host', 'The gateway and every address the host answers on are open on no port: the front door, the Docker daemon, anything you run locally.', []),
  ]));

  // Internal service
  const wikiPermitted = e.allowed.includes('wiki.example.lan') && e.isolated !== 'on';
  const wikiExempt = e.internal === 'wiki.example.lan';
  add('dejima', 'internal', 'Reach an internal service', guard(!fw ? [
    step(['s-harness', 'bridge', ...nodeFw, 'lan-wiki'], dv ? 'refused' : 'warn', dv ? 'The node firewall drops it' : 'Delivered',
      dv ? 'Even with dejima\'s filter off, rules 7-9 on the node drop 10/8.' : 'With the firewall off, the session has the laptop\'s LAN reach.', ['firewall']),
  ] : [
    step(['s-harness', 's-dns'], wikiPermitted ? 'ok' : 'refused', 'Look up wiki.example.lan',
      wikiPermitted ? 'Permitted by the project\'s approval, so it is forwarded.' : 'Not permitted. internal_domains cannot help: it exempts a permitted name, it never permits one.', ['allowed', 'internal']),
    wikiPermitted && step(['s-dns', 'bridge', ...nodeFw, 'lan-resolver', 's-dns'], wikiExempt ? 'ok' : 'refused', 'The answer is 10.0.0.30',
      wikiExempt ? 'internal_domains exempts it, so the private answer is accepted and the address goes into internal_ok_v4.'
        : 'A private address for a non-exempt name looks like DNS rebinding. dnsmasq refuses the answer, and nftables would refuse the connection too. Add the name to [core] internal_domains to allow it.',
      ['internal']),
    wikiPermitted && wikiExempt && step(['s-harness', 'g-nft', 'bridge', ...nodeFw, 'lan-wiki'], dv ? 'refused' : 'ok', dv ? 'dejima allows it; the node does not' : 'Connect',
      dv ? 'Rules 7-9 drop 10/8 on the Proxmox node, outside the guest. Only the forge, the resolver, and ntfy are pinholed. The drop is logged.' : 'Accepted.', ['internal']),
  ]));

  // Files
  add('dejima', 'files', 'Read and write files', guard([
    step(['s-harness', 'm-project', 'f-project'], 'ok', `Write ${e.isolated === 'on' ? '/dejima/work' : 'the project'}`,
      e.isolated === 'on' ? 'A volume that is removed when the session closes.' : 'This is the work: it lands in your directory and stays.', ['isolated']),
    step(['s-harness', 'm-share', 'f-share'], 'ok', 'Leave something in ~/shared', e.isolated === 'on' ? 'A fresh share for this session only.' : 'Every session on this project sees the same directory.', ['isolated']),
    e.ro !== 'unset' && step(['s-harness', 'm-ro'], 'refused', `Write to ${e.ro}`, 'Read-only mount: reads work, writes fail with EROFS.', ['ro']),
    e.rw !== 'unset' && step(['s-harness', 'm-rw', 'f-rw'], 'ok', `Write to ${e.rw}`, 'Shared by every project that mounts it.', ['rw']),
    e.rwpp !== 'unset' && step(['s-harness', 'm-rwpp', 'f-rwpp'], 'ok', `Write to ${e.rwpp}`, 'Lands in this project\'s own subdirectory.', ['rwpp']),
    step(['s-harness', 'c-mounts'], 'refused', 'Read ~/.ssh or ~/.config/dejima', 'Not mounted, so there is no path to it. Nothing inside can see the approval store or the audit records.', []),
  ]));

  // Push
  const pushSteps = !e.pushes ? [
    step(['s-harness', 's-guards'], 'refused', 'git push', `[core] workflow = local-only${e.overrides.workflow ? ` (${e.overrides.workflow})` : ''}: DEJIMA_PUSH_HOSTS is empty, so every push is refused.`, ['workflow']),
  ] : [
    step(['s-harness', 's-guards'], 'refused', 'git push origin main', 'Refused: main and master are blocked branches.', ['workflow']),
    step(['s-harness', 's-guards'], 'ok', 'git push origin agent/fix-tests', `To ${e.forge === 'github' ? 'github.com' : 'git.example.lan'}, a push host. Allowed.`, ['workflow', 'forge']),
    e.forge === 'github'
      ? step(['s-guards', 'g-nft', ...out('net-github')], 'ok', 'Port 22 to GitHub', 'forge = github with a pushing workflow opens 22 to GitHub\'s ranges.', ['forge', 'ghpush'])
      : step(['s-guards', 'g-nft', 'bridge', ...nodeFw, 'lan-forge'], 'ok', 'To the forge', `The forge host is permitted and internal-exempt${dv ? '; node rule 4 lets the devbox reach it on 22' : ''}.`, ['forge']),
    on.ci && step(['lan-forge', ...(cfg.ci_tiers !== 'privileged' ? ['fw-ci-c', 'r1-1'] : ['fw-ci-p', 'cip-runner'])], 'warn', 'The push queues CI',
      'Push access is code execution on whatever runner the repo reaches. That is what the CI hardener is for.', ['workflow']),
  ];
  add('dejima', 'push', 'Push a branch', guard(pushSteps));

  // Escape
  add('dejima', 'escape', 'Escape the container', guard([
    step(['s-harness', 'c-session'], 'info', 'Suppose a kernel bug lets it out', 'A container escape is in the threat model, not the end of it. The question is what lies under the container.', []),
    dv ? step(['dejima-host', 'fw-devbox'], 'refused', 'Go looking on the LAN', 'Now root on the devbox, it tries the NAS. Rules 7-9 drop it on the node, where the guest cannot reach, and log it to pve-firewall.log.', [])
      : step(['dejima-host', 'lan-nas'], 'warn', 'Go looking on the LAN', 'On a laptop, nothing below the container bounds it. It has your user, your home directory, and your LAN.', []),
    dv && step(['fw-devbox', 'pve-log'], 'info', 'The drop is logged', 'Written by the hypervisor. A quiet log going loud is the strongest signal you get.', []),
    dv && step(['dejima-host', 'fw-devbox', 'lan-router', 'net-unlisted'], 'warn', 'The internet is still open', 'The devbox reaches public IPv4 on any port, on purpose. The wall is around your LAN, not around the internet.', []),
    on.guard && step(['gd-cycle', ...nodeFw, 'p-guardshell'], 'info', 'Within 15 minutes, the guard looks', 'A new file in a watched path, a new unit, or a new listener alerts at max priority. Unless the payload thought to forge the state.', []),
  ]));

  // Close
  const iso = e.isolated === 'on';
  add('dejima', 'close', 'Close the session', guard([
    step(['c-session'], 'info', 'The session container is removed', 'compose run --rm: its filesystem is gone, and with it the staged ~/.claude.json, the gitconfig copy, and any fake credential.', [], { gone: ['c-session'] }),
    e.proxied && step(['p-proxy'], 'info', 'The proxy stops', 'Its socket directory is deleted. The proxy log is summarised on your terminal: errors, auth failures, and what to do about them.', [], { gone: ['p-proxy', 'p-shipper'] }),
    step(['c-filter'], 'info', 'The filter and the network go', 'docker rm -f the filter, docker network rm dejima-run-…. Live dejima-allow --container grants die with them.', [], { gone: ['docker'] }),
    step(['p-launcher'], 'info', 'Image tags are released', 'This run\'s tags are dropped and unreferenced layers reclaimed.', []),
    iso && step(['f-project'], 'info', 'The work volume is removed', 'An isolated session keeps nothing it was not told to. An empty share is removed too.', [], { gone: ['f-project'] }),
    e.epitaph === 'on' && step(['p-launcher', 'f-stores'], 'ok', 'The epitaph is saved', 'The compaction summaries are copied host-side, to the epitaph store.', ['epitaph']),
    !iso && step(['p-launcher', 'f-project'], 'info', 'The exit-time audit runs', 'It diffs .git/config, hooks, .mcp.json, .envrc, and friends against the launch snapshot. A new core.hooksPath or credential.helper is CRITICAL.', []),
    step(['f-share'], 'ok', 'What is left', iso ? 'The share, if the agent wrote to it. Nothing else.' : 'The project, ~/shared, writable mounts, the harness\'s per-project state, epitaphs, and the audit record.', [],
      { kept: ['f-project', 'f-share', 'f-rw', 'f-rwpp', 'f-stores'].filter(x => !(iso && x === 'f-project')) }),
  ]));

  // ---- remote access ----------------------------------------------------
  if (on.remote) {
    const web = cfg.ra_doors !== 'ssh', ssh = cfg.ra_doors !== 'web';
    if (cfg.ra_ntfy !== 'unset') add('remote', 'ra-notify', 'Get a push when it finishes', guard([
      step(['s-harness', 'm-notify', 'p-notify'], 'ok', 'The Stop hook writes a marker',
        e.harness === 'claude-code' ? 'An empty file named done. That is all the session can say: the push never carries what it wants.' : 'Cline hosts no hooks, so it never writes one: no push for this harness.', ['harness']),
      e.harness === 'claude-code' && step(['p-notify', ...nodeFw, 'lan-ntfy'], dv && cfg.dv_6b === 'off' ? 'refused' : 'ok', 'POST to ntfy',
        dv ? (cfg.dv_6b === 'off' ? 'notify-watch runs on the VM, so its post is LAN traffic: rules 7-9 drop it. Silently.' : 'Rule 6b opens tcp/8443 to the ntfy-only listener, above the DROPs.')
          : 'From the host, outside the container\'s allowlist.', ['ra_ntfy', 'dv_6b']),
      e.harness === 'claude-code' && !(dv && cfg.dv_6b === 'off') && step(['lan-ntfy', 'ph-ntfy'], 'ok', '"dejima: proj finished"',
        cfg.ra_base !== 'unset' && web ? 'Tap opens https://dejima.example.lan/?arg=<run id>.' : 'No base_url, so there is no link to tap.', ['ra_base']),
    ]));
    if (web) add('remote', 'ra-web', 'Attach from the phone, web', guard([
      step(['ph-web', ...nodeFw, 'p-nginx'], 'ok', 'TLS, then Basic auth', dv ? 'Node rule 2 admits the front-door subnet, the narrower list: Basic auth has no lockout and no second factor.' : 'No node firewall: anyone on your LAN can try the password.', ['ra_doors']),
      step(['p-nginx', 'p-ttyd'], 'ok', 'To ttyd on loopback', 'proxy_pass http://127.0.0.1:7681. --check-origin refuses a WebSocket opened by another site.', []),
      step(['p-ttyd', 'p-attach'], 'ok', '?arg=<run id>', 'ttyd passes the run id to dejima-attach, which checks it is 16 hex characters.', []),
      step(['p-attach', 's-harness'], 'ok', 'Attached', 'A throwaway grouped tmux session on that window. SESS goes back to the picker without reloading.', []),
    ]));
    if (ssh) add('remote', 'ra-ssh', 'Attach from the phone, SSH', guard([
      step(['ph-ssh', ...nodeFw, 'p-sshd'], 'ok', 'SSH with the phone key', dv ? 'Node rule 1, from the admin subnet.' : 'sshd on the laptop.', ['ra_doors']),
      step(['p-sshd', 'p-attach'], 'ok', 'The forced command runs', 'restrict,pty,command="…/dejima-attach": whatever the client asked for, it gets the picker.', []),
      step(['p-attach', 's-harness'], 'ok', 'Pick a number', '  1  ● proj  waiting  4m. Type 1, you are in.', []),
    ]));
    add('remote', 'ra-lan', 'Someone else on the LAN tries the door', [
      dv ? step(['lan-nas', 'fw-devbox'], 'refused', 'Dropped at the node', 'Not in the front-door or admin subnet: inbound policy DROP.', [])
        : step(['lan-nas', web ? 'p-nginx' : 'p-sshd'], 'warn', 'It reaches the door', 'On a laptop the perimeter is "on my LAN". The door\'s own auth is the only gate.', []),
    ]);
    add('remote', 'ra-sandbox', 'The session tries the front door', guard([
      step(['s-harness', 'g-nft'], fw ? 'refused' : 'warn', 'Connect to 10.0.0.24:443', fw ? 'A host address on a port nobody opened. The clamp refuses it, and nginx is not bound to the bridge either.' : 'With the firewall off, only nginx\'s bind address keeps it out.', ['firewall']),
    ]));
  }

  // ---- devbox-hardener --------------------------------------------------
  if (dv) {
    add('devbox', 'dv-reach', 'The hourly reach audit', [
      step(['p-audit', 'fw-devbox', 'lan-router'], 'ok', 'Probe the gateway on 443, 80, 22', 'Every probe must time out. DROP looks like silence; a REJECT would read as FAIL.', []),
      step(['p-audit', 'fw-devbox', 'lan-forge'], 'ok', 'Positive control: the forge', 'The forge answers on 443, so silence means blocked, not offline. Verdict PASS.', []),
      step(['p-audit'], 'info', 'Then IPv6', 'Ping ff02::1 on the default interface: any neighbour answering is FAIL.', []),
    ]);
    add('devbox', 'dv-in', 'A LAN host tries SSH into the devbox', [
      step(['lan-nas', 'fw-devbox'], 'refused', 'Inbound policy DROP', 'Only the admin subnet gets 22, and only the front-door subnet gets the front door.', []),
      step(['lt-ssh', 'fw-devbox', 'dejima-host'], 'ok', 'You, from the admin subnet', 'Node rule 1.', []),
    ]);
  }

  // ---- ci-hardener ------------------------------------------------------
  if (on.ci) {
    const conf = cfg.ci_tiers !== 'privileged', priv = cfg.ci_tiers !== 'confined';
    const two = cfg.ci_pools !== 'alice/proj';
    if (conf) {
      add('ci', 'ci-render', 'Render the allowlist from main', [
        step(['ci-timer', 'fw-ci-c', 'lan-forge'], 'ok', 'GET …/alice/proj/raw/.dejima/allowed-domains?ref=main',
          'Over the forge API with a read-only token, never from a checkout. A pull request cannot widen it: only what merged to main counts. Node rule 2.', ['ci_pools']),
        two && step(['ci-timer', 'fw-ci-c', 'lan-forge'], 'ok', 'GET every repo bob owns', 'A bare owner expands through /users/bob/repos. Pool 2\'s set is the union of all of them.', ['ci_pools']),
        step(['ci-timer', 'ci-dns'], 'ok', 'Write and test the dnsmasq file', 'server=/pypi.org/<upstream> and ipset=/pypi.org/ci-allow-1. It must pass dnsmasq --test; removed names flush the sets; dnsmasq restarts.', []),
        step(['ci-timer'], 'info', 'Any failure keeps the last list', 'A 401, a redirect, an invalid name, or an empty result all leave the previous allowlist in place.', []),
      ]);
      add('ci', 'ci-job', 'Run a confined job', [
        step(['lan-forge', 'fw-ci-c', 'r1-1'], 'ok', 'A runner picks up the job', 'Gitea offers it to runners registered to a scope covering the repo, with a matching label. Node rule 2, tcp/443.', ['ci_count']),
        step(['r1-1', 'job-1'], 'ok', 'Start the job container', 'On dejima-ci1, --dns at the gateway, no Docker socket, NET_ADMIN and NET_RAW dropped.', []),
        step(['job-1', 'ci-dns'], 'ok', 'Look up pypi.org', 'alice/proj declares it on main, so it resolves and its addresses go into ci-allow-1.', ['ci_pools']),
        step(['job-1', 'ci-fwd', 'fw-ci-c', 'lan-router', 'net-pypi'], 'ok', 'Connect on 443', 'DEJIMA-CI-FWD accepts tcp 80/443 to the pool\'s set.', []),
        step(['job-1', 'ci-dns'], 'refused', 'Look up example.net', 'REFUSED: not on any list.', []),
        step(['job-1', 'ci-fwd'], 'refused', 'Try the NAS', 'REJECT in the VM, and rules 5-7 on the node behind it.', []),
      ]);
      if (two) add('ci', 'ci-cross', 'A job tries another pool\'s name', [
        step(['job-1', 'ci-dns'], 'warn', 'It resolves', 'Every pool shares one dnsmasq, so every job can resolve every allowlisted name.', ['ci_pools']),
        step(['job-1', 'ci-fwd'], 'refused', 'It cannot connect', 'The address went into ci-allow-2, and dejima-ci1\'s rules name only ci-allow-1 and base. The leak is names, not reach.', ['ci_pools']),
      ]);
      if (cfg.ci_count !== '1') add('ci', 'ci-neighbour', 'Two jobs in one pool', [
        step(['job-1', 'r1-2'], 'warn', 'They can reach each other', 'Runners in a pool share its bridge, so concurrent jobs and their service containers are neighbours. Nothing isolates them.', ['ci_count']),
      ]);
    }
    if (priv) add('ci', 'ci-priv', 'Run a privileged job', [
      step(['lan-forge', 'fw-ci-p', 'cip-runner'], 'ok', 'The one runner picks it up', 'runs-on: dejima-privileged.', ['ci_tiers']),
      step(['cip-runner', 'cip-sock', 'cip-job'], 'ok', 'Start it with the socket', 'docker_host = "" mounts the socket; container.network = host gives it the VM\'s network.', []),
      step(['cip-job', 'cip-sock'], 'ok', 'docker build, docker run', 'What confined jobs cannot do: build images, boot containers, run dejima\'s runtime.bats.', []),
      step(['cip-job', 'fw-ci-p', 'lan-router', 'net-unlisted'], 'ok', 'Any public address', 'No allowlist in this VM. A job holding the socket could flush one, so none is pretended.', []),
      step(['cip-job', 'fw-ci-p'], 'refused', 'Try the NAS', 'Rules 5-7 on the node: it reaches the internet, not your network.', []),
    ]);
    add('ci', 'ci-rollback', 'Sunday 04:00', [
      conf && step(['pve-cron', 'vm-ci-c'], 'info', 'Roll back the confined VM', 'qm shutdown, qm rollback <vmid> clean, qm start. The allowlist timer re-renders 2 minutes after boot.', []),
      priv && step(['pve-cron', 'vm-ci-p'], 'info', 'Roll back the privileged VM', 'Whatever a job left behind is gone.', []),
    ]);
  }

  // ---- guard ------------------------------------------------------------
  if (on.guard) {
    const win = cfg.gd_expect !== 'closed';
    const alertTo = cfg.gd_alert === 'ntfy_url' ? ['lan-ntfy', 'ph-ntfy'] : ['gd-cycle'];
    const collect = [
      step(['gd-cycle', 'fw-devbox', 'p-guardshell'], 'ok', 'SSH in with the guard key',
        `${cfg.gd_place === 'other segment' ? 'Node rule 2b, the guard\'s one address' : 'Node rule 1, from the admin subnet'}. The key's forced command is dejima-guard-shell, no-pty.`, ['gd_place']),
      step(['p-guardshell', 'p-audit'], 'ok', 'drift --state, then reach', 'The only two commands the forced command and sudoers allow.', []),
      step(['p-audit', 'p-guardshell', 'fw-devbox', 'gd-cycle'], 'ok', 'The state comes back', 'File hashes, symlinks, enabled units, listeners. Capped at 8 MiB.', []),
    ];
    add('guard', 'gd-clean', 'A scan: nothing changed', [
      ...collect,
      step(['gd-cycle', 'gd-baseline'], 'ok', 'Diff against its own baseline', 'Clean, and reach said PASS.', []),
      cfg.gd_hb !== 'unset' ? step(['gd-cycle', 'lan-kuma'], 'ok', 'Heartbeat', 'A clean cycle sends no alert, only this ping. If the pings stop, Kuma fires.', ['gd_hb'])
        : step(['gd-cycle'], 'warn', 'No heartbeat_url', 'A guard that dies quietly looks the same as a devbox that is fine.', ['gd_hb']),
    ]);
    add('guard', 'gd-keys', 'A scan: authorized_keys changed', [
      ...collect,
      step(['gd-cycle', 'gd-baseline'], 'refused', 'A watched path changed', 'authorized_keys is a critical path: alerted at max, never ignored, never accepted by a window.', ['gd_expect']),
      step(['gd-cycle', ...alertTo], 'ok', 'Alert: max priority', 'The body says "1 file(s) modified in ~/.ssh" and nothing more. Detail stays in dejima-guard report, on the guard.', ['gd_alert']),
    ]);
    add('guard', 'gd-listener', 'A scan: a new listener', [
      ...collect,
      step(['gd-cycle', 'gd-baseline'], win ? 'info' : 'refused', win ? 'Held: the window is open' : 'A new PORT line', win ? 'dejima-guard expect opened a window. The change is held, and accepted when it closes.' : 'New listeners and units alert at max.', ['gd_expect']),
      !win && step(['gd-cycle', ...alertTo], 'ok', 'Alert: max priority', '"new listener or unit".', ['gd_alert']),
    ]);
    add('guard', 'gd-down', 'The devbox stops answering', [
      step(['gd-cycle', 'fw-devbox'], 'refused', 'SSH times out', `After ssh_timeout = 10 s.${win ? ' Inside a window, this is held.' : ''}`, ['gd_expect']),
      !win && step(['gd-cycle', ...alertTo], 'ok', 'Alert: unreachable', 'At max. Silence is a finding.', ['gd_alert']),
    ]);
    add('guard', 'gd-pull', 'The devbox tries to reach the guard', [
      step(['dejima-host', 'fw-devbox'], 'refused', 'No rule for it', 'The guard pulls; the devbox never connects out to it. A rule "for symmetry" would give that away.', []),
    ]);
  }

  // ---- darner -----------------------------------------------------------
  if (on.darner && cfg.dn_front.length) {
    const h = cfg.dn_harness === 'default' ? e.harness : cfg.dn_harness;
    const dnRefused = refusals(effective(normalise({ ...cfg, on: { ...cfg.on }, isolated: 'on', harness: h,
      drop: cfg.dn_net === 'default' ? 'off' : 'on', sealed: cfg.dn_net === 'sealed' ? 'on' : 'off' })));
    const sealedRefused = dnRefused.length > 0;
    const netFlag = { default: '', named: ' --drop-domains', sealed: ' --require-sealed' }[cfg.dn_net];
    const middle = [
      step(['p-dn-api', ...nodeFw, 'p-dn-launch'], 'ok', 'ssh to the launcher', `${dv ? 'Node rule 1. ' : ''}The key is from="<API>",command="darner-launch …",restrict. The job arrives as JSON on stdin.`, []),
      step(['p-dn-launch', 'dn-harness'], sealedRefused ? 'refused' : 'ok', `dejima --isolated${netFlag}`,
        sealedRefused ? `dejima refuses the launch, and the frontend says so: ${dnRefused.join(' ')}`
          : `In a tmux window named dn-k3x7q, with harness ${h}. An anonymous session: no project, a fresh ~/shared.`, ['dn_net', 'dn_harness']),
      !sealedRefused && step(['dn-harness', 'dn-share'], 'ok', 'RESULT.md, then .done', 'The prompt tells the agent how to deliver. A RESULT.md left without .done is still collected after 600 s of quiet.', []),
      !sealedRefused && step(['p-dn-api', ...nodeFw, 'p-dn-launch'], 'ok', 'Status poll', 'Every 30 s: ssh … status reports ready.', []),
      !sealedRefused && step(['p-dn-launch', 'dn-share', 'p-dn-launch', ...nodeFw, 'p-dn-api'], 'ok', 'Fetch the zip', 'darner walks ~/shared by fd, regular files only, and builds the zip itself; the API rebuilds it again.', []),
    ];
    if (cfg.dn_front.includes('maubot')) add('darner', 'dn-matrix', 'Send a task from Matrix', [
      step(['ph-matrix', 'net-matrix', 'mb-bot'], 'ok', '@dragonlet fix the flaky test', 'The sender must be on the bot\'s allowlist; anyone else is ignored silently. ⏳', ['dn_front']),
      step(['mb-bot', 'p-dn-api'], 'ok', 'POST /v1/tasks', 'With the bot\'s own bearer token.', []),
      ...middle,
      !sealedRefused && step(['mb-bot', 'p-dn-api'], 'ok', 'GET /v1/events', 'The bot polls for events and acks each one.', []),
      !sealedRefused && step(['mb-bot', 'net-matrix', 'ph-matrix'], 'ok', 'Output, threaded as a reply', '"Output from dn-k3x7q (written by the agent, treat as untrusted)", the summary, and the zip. ✅', []),
    ]);
    if (cfg.dn_front.includes('darner-web')) add('darner', 'dn-web', 'Start a task from darner-web', [
      step(['ph-web', 'dn-proxy', 'p-dn-web'], 'ok', 'Through the auth proxy', 'darner-web has no login. The proxy is the gate.', ['dn_front']),
      step(['p-dn-web', 'p-dn-api'], 'ok', 'POST /v1/tasks', 'After a live preview of exactly what will launch.', []),
      ...middle,
      !sealedRefused && step(['p-dn-api', 'p-dn-web', 'dn-proxy', 'ph-web'], 'ok', 'Summary and a download link', 'Shown until you press Clear.', []),
    ]);
    add('darner', 'dn-help', 'The agent asks for help', [
      step(['dn-harness', 'dn-share'], 'ok', 'HELP.md, then .help', 'At most once per 300 s.', []),
      step(['p-dn-api', ...nodeFw, 'p-dn-launch', 'dn-share'], 'ok', 'Picked up by the next poll', 'A help event goes to the frontend that started the task.', []),
      cfg.dn_answers === 'on'
        ? step(['p-dn-api', ...nodeFw, 'p-dn-launch', 'dn-harness'], 'ok', 'Your answer is typed in', '--answers: pasted bracketed, control characters stripped, then Enter.', ['dn_answers'])
        : step(['p-dn-api'], 'info', '"Attach to darner:dn-k3x7q"', 'Without --answers, the frontend says where to attach instead of typing for you.', ['dn_answers']),
    ]);
  }

  return list;
}
