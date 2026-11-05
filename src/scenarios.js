// scenarios(cfg, derived) -> what the user can play. Each step draws one line
// along `path` (node ids) and ends with a verdict:
//   ok       allowed, delivered
//   refused  stopped at the last node of the path
//   warn     delivered, and it should worry you
//   info     a fact about this moment, nothing moves through a wall
// `gone` fades nodes for the rest of the run; `kept` marks what survives.
import { effective, normalise, refusals, notes } from './config.js';

const step = (path, verdict, title, detail, keys = [], o = {}) => ({ path, verdict, title, detail, keys, ...o });

export function scenarios(cfg, d) {
  const { e, refused } = d;
  const on = cfg.on;
  const dv = on.devbox;
  const fw = e.firewall === 'on';
  const nodeFw = dv ? ['fw-devbox'] : [];
  const out = dest => ['bridge', ...nodeFw, 'lan-router', dest];
  const cline = e.harness === 'cline';
  const list = [];
  const add = (project, id, title, steps) => list.push({ project, id, title, steps: steps.filter(Boolean) });
  const launchBlocked = refused.length
    ? [step(['p-launcher'], 'refused', 'dejima refuses to launch', refused.join(' '), ['sealed', 'internal', 'workflow', 'cline_model'])]
    : null;
  const guard = s => launchBlocked || s;
  const approved = name => (e.isolated !== 'on' && e.allowed.includes(name)) || (e.drop !== 'on' && e.global.includes(name));
  const approvedBy = name => (e.isolated !== 'on' && e.allowed.includes(name) ? 'the project\'s approval' : 'a global approval');

  // ---- dejima -----------------------------------------------------------
  const selfCheck = d.sealed
    ? 'nftables loads and dnsmasq starts with no name to forward. The positive checks are skipped, since nothing should resolve; the negative ones confirm an unpermitted name and address are refused and IPv6 is refused. The ready record says resolver_upstream: false, and the banner shows S E A L E D.'
    : `nftables loads and dnsmasq starts with ${d.names.length} forwarded names. A self-check then resolves each one (a private answer for a name that is not exempt fails it), asserts IPv6 is refused and AAAA stripped${e.drop === 'on' ? '' : ', and that port 22 is refused unless granted'}.`;
  add('dejima', 'launch', 'Launch a session', [
    step(['p-launcher', 'f-stores'], 'info', 'Read config and approvals',
      'Flags beat ~/.config/dejima/config, which beats the pinned defaults. Approved domains and dependencies are unioned: built-in, then global, then project.',
      ['isolated', 'allowed', 'global']),
    ...(launchBlocked || [
      e.proxied && step(['p-launcher', 'p-proxy'], 'info', 'Start the credential proxy',
        `A host process on a fresh unix socket, holding the ${e.backend} credential. The container will only ever see a placeholder.`, ['proxy', 'backend']),
      ...notes(e).map(n => step(['p-launcher'], 'warn', 'The launch carries on', n, ['internal', 'firewall'])),
      step(['p-launcher', 'docker'], 'info', 'Create the network', 'dejima-run-<run id>: a user-defined bridge, one per launch.', []),
      step(['p-launcher', 'c-filter'], fw ? 'ok' : 'warn', fw ? 'Start the filter and check it' : 'Start the filter, with nothing in it',
        fw ? selfCheck : '[core] firewall = off: firewall-up.sh exits before loading a rule, and resolv.conf is left alone.', ['firewall', 'drop', 'sealed']),
      step(['p-launcher', 'c-session'], 'ok', 'Start the session inside it',
        'The session joins the filter\'s network namespace. Its entrypoint points resolv.conf at 127.0.0.1, installs the guards, drops every capability, and runs the harness.',
        ['harness']),
    ]),
  ]);

  // Ask the model
  add('dejima', 'api', 'Ask the model', guard(e.selfHosted ? (!fw ? [
    step(['s-harness', 'bridge', ...(dv ? ['fw-devbox'] : ['lan-llm'])], dv ? 'refused' : 'warn', dv ? 'The node firewall drops it' : 'Nothing filters it',
      dv ? 'With dejima\'s filter off there is no rule at all in the session, but rules 7-9 on the node still drop 10/8.'
        : 'With [core] firewall = off there are no rules and no sets: the model is reachable like everything else.', ['firewall']),
  ] : [
    e.llmByName
      ? step(['s-harness', 's-dns', 'bridge', ...nodeFw, 'lan-resolver'], 'ok', 'Look up llm.example.lan',
          'The name had to be approved before cline would launch. As the base_url host it is then permitted and internal-exempt, so its private answer is accepted, and the resolver keeps an upstream.', ['base_url', 'allowed', 'global'])
      : step(['s-harness', 'g-nft'], 'ok', '10.0.0.10 is permitted by address',
          'An IPv4 base_url goes straight into the literal set. No DNS, so no answer to check, and internal_domains does not apply.', ['base_url']),
    step(['s-harness', 'g-nft', 'bridge', ...(dv ? ['fw-devbox'] : ['lan-llm'])], dv ? 'refused' : 'ok', dv ? 'The node firewall drops it' : 'Straight to the model',
      dv ? 'dejima allows it, but the devbox may only reach the forge and the resolver on the LAN. Rules 7-9 drop 10/8. A LAN model needs its own pinhole above the DROPs.'
        : 'No credential exists, so there is no proxy and no placeholder. The request crosses nftables like any other permitted connection.', ['backend']),
  ]) : e.proxy === 'off' ? [
    step(['s-harness', 'm-cred'], 'warn', 'Read the real credential', 'With [credentials] proxy = off, the credential file is mounted into the container. The agent can read it, and send it anywhere it can reach.', ['proxy']),
    fw && step(['s-harness', 's-dns'], 'ok', `Look up ${e.apiHost}`, 'The API name joins the open list when the proxy is off.', ['proxy']),
    step(['s-harness', ...(fw ? ['g-nft'] : []), ...out('net-api')], 'warn', 'Straight to the API, with the real key', 'Through the filter, through the host, out. Nothing on the way can tell your key from a copy.', ['proxy']),
  ] : [
    step(['s-harness', 's-term'], 'ok', e.transport === 'tls' ? `${e.apiHost} resolves to 127.0.0.1` : 'ANTHROPIC_BASE_URL → 127.0.0.1:18300',
      e.transport === 'tls' ? '/etc/hosts maps it to loopback, so no DNS query is made. A terminator with a cert dejima made for this session ends TLS there.'
        : 'ANTHROPIC_BASE_URL points at a plain-HTTP forwarder on 127.0.0.1:18300.', ['transport']),
    step(['s-term', 'm-sock', 'p-proxy'], 'ok', 'Down the socket, not the network',
      'A unix socket in a read-only mounted directory. API traffic never crosses nftables, and the API name is not on the allowlist: resolving it by DNS returns nothing.', ['proxy']),
    step(['p-proxy', 'f-cred'], 'info', 'Swap in the real credential',
      e.backend === 'anthropic' ? 'The proxy replaces the placeholder Bearer token with your OAuth token, refreshing it when it expires.' : 'The proxy replaces the placeholder key with the real one.', ['backend']),
    step(['p-proxy', ...nodeFw, 'lan-router', 'net-api'], 'ok', 'Upstream, from the host',
      dv ? 'The proxy runs on the devbox, outside the container. The node allows public IPv4 by its outbound policy.' : 'The proxy connects from your laptop\'s own network.', ['backend']),
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
  const pypiOk = approved('pypi.org');
  add('dejima', 'pypi', 'Reach a name the project declares', guard(!fw ? [
    step(['s-harness', ...out('net-pypi')], 'warn', 'No filter at all', 'Everything is reachable with the firewall off.', ['firewall']),
  ] : [
    step(['s-harness', 's-dns'], pypiOk ? 'ok' : 'refused', 'Look up pypi.org',
      pypiOk ? `Permitted by ${approvedBy('pypi.org')}, so it is forwarded.`
        : e.isolated === 'on' && e.allowed.includes('pypi.org') ? 'An isolated session has no project, so project approvals do not apply. A global approval, or dejima --isolated --domains FILE, would grant it.'
          : e.drop === 'on' && e.global.includes('pypi.org') ? '--drop-domains drops global approvals. A project approval would survive it.'
            : 'Not permitted. The project can declare it in .dejima/allowed-domains, but nothing changes until you run dejima-project approve on the host. dejima-allow --container grants it to this session only.',
      ['allowed', 'global', 'isolated']),
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

  // Internal service. A permitted, non-exempt private name never gets this
  // far: the launch's self-check refuses it, and guard() shows that.
  const wikiPermitted = approved('wiki.example.lan');
  add('dejima', 'internal', 'Reach an internal service', guard(!fw ? [
    step(['s-harness', 'bridge', ...(dv ? ['fw-devbox'] : ['lan-wiki'])], dv ? 'refused' : 'warn', dv ? 'The node firewall drops it' : 'Delivered',
      dv ? 'Even with dejima\'s filter off, rules 7-9 on the node drop 10/8.' : 'With the firewall off, the session has the laptop\'s LAN reach.', ['firewall']),
  ] : !wikiPermitted ? [
    step(['s-harness', 's-dns'], 'refused', 'Look up wiki.example.lan', 'Not permitted. internal_domains cannot help: it exempts a permitted name, it never permits one.', ['allowed', 'global', 'internal']),
  ] : [
    step(['s-harness', 's-dns', 'bridge', ...nodeFw, 'lan-resolver'], 'ok', 'Look up wiki.example.lan',
      `Permitted by ${approvedBy('wiki.example.lan')}, and exempt in [core] internal_domains, so its answer, 10.0.0.30, is accepted and goes into internal_ok_v4. Without the exemption the launch itself would have been refused.`, ['internal']),
    step(['s-harness', 'g-nft', 'bridge', ...(dv ? ['fw-devbox'] : ['lan-wiki'])], dv ? 'refused' : 'ok', dv ? 'dejima allows it; the node does not' : 'Connect',
      dv ? 'Rules 7-9 drop 10/8 on the Proxmox node, outside the guest. Only the forge and the resolver (and ntfy, with 6b) are pinholed. The drop is logged.' : 'Accepted.', ['internal']),
  ]));

  // Files
  add('dejima', 'files', 'Read and write files', guard([
    step(['s-harness', 'm-project', 'f-project'], 'ok', `Write ${e.isolated === 'on' ? '/dejima/work' : 'the project'}`,
      e.isolated === 'on' ? 'A volume that is removed when the session closes.' : 'This is the work: it lands in your directory and stays.', ['isolated']),
    e.isolated !== 'on' && step(['s-harness', 'm-project'], 'refused', 'Write .git/hooks/pre-commit', '.git/hooks is mounted read-only over the project, so a hook planted there never runs. core.hooksPath in .git/config is still writable; the exit-time audit reports a change to it, after the session.', []),
    step(['s-harness', 'm-share', 'f-share'], 'ok', 'Leave something in ~/shared', e.isolated === 'on' ? 'A fresh share for this session only.' : 'Every session on this project sees the same directory.', ['isolated']),
    e.ro !== 'unset' && step(['s-harness', 'm-ro'], 'refused', `Write to ${e.ro}`, 'Read-only mount: reads work, writes fail with EROFS.', ['ro']),
    e.rw !== 'unset' && step(['s-harness', 'm-rw', 'f-rw'], 'ok', `Write to ${e.rw}`, 'Shared by every project that mounts it.', ['rw']),
    e.rwpp !== 'unset' && step(['s-harness', 'm-rwpp', 'f-rwpp'], 'ok', `Write to ${e.rwpp}`, 'Lands in this project\'s own subdirectory.', ['rwpp']),
    step(['s-harness', 'c-mounts'], 'refused', 'Read your SSH keys or ~/.config/dejima', 'Not mounted, so there is no path to them. Only ~/.ssh/known_hosts is, read-only. Nothing inside can see the approval store or the audit records.', []),
    e.agent && step(['s-harness', 'm-agent'], 'warn', 'Sign with your SSH agent', 'A pushing workflow with no [identity] ssh_key mounts your forwarded agent. The keys stay unreadable, but anything the agent will sign, the session can.', ['ssh_key']),
  ]));

  // Push
  const signer = e.ssh_key !== 'unset' ? 'Signed with the session key.' : e.agent ? 'Signed through your forwarded agent at /ssh-agent.' : '';
  const toForge = e.forge === 'github' || !e.pushes
    ? step(['s-guards', 'g-nft', ...out('net-github')], e.ssh_key === 'unset' && !e.agent ? 'warn' : 'ok', 'Port 22 to GitHub',
      `${e.pushes ? 'forge = github with a pushing workflow' : '--allow-github-push'} opens 22 to GitHub's ranges. ${e.ssh_key === 'unset' && !e.agent ? 'Under local-only no agent is forwarded and no ssh_key is set, so the network lets it through and GitHub refuses the login.' : signer}`, ['forge', 'ghpush', 'ssh_key'])
    : step(['s-guards', 'g-nft', 'bridge', ...nodeFw, 'lan-forge'], 'ok', 'To the forge', `The forge host is permitted and internal-exempt${dv ? '; node rule 4 lets the devbox reach it on 22' : ''}. ${signer}`, ['forge', 'ssh_key']);
  const mergeStep = e.forge !== 'none' && step(['s-harness', 's-guards'], 'refused', e.forge === 'github' ? 'gh pr merge' : 'gitea-pr merge',
    'Every workflow blocks merges, local-only included. The forge guard refuses it before the forge is asked; what really decides is the token\'s scope.', ['workflow']);
  const pushSteps = !e.pushHosts.length ? [
    step(['s-harness', 's-guards'], 'refused', 'git push', `[core] workflow = local-only${e.overrides.workflow ? ` (${e.overrides.workflow})` : ''}: DEJIMA_PUSH_HOSTS is empty, so every push is refused.${cline ? ' Under cline this is only the git wrapper on PATH: /usr/bin/git steps around it and no hook catches that, so what really stops it is no SSH route and no credential GitHub will accept a write from.' : ''}`, ['workflow', 'ghpush']),
    mergeStep,
  ] : [
    e.blocked.length
      ? step(['s-harness', 's-guards'], 'refused', 'git push origin main', `Refused: main and master are blocked branches.${cline ? ' Under cline this is only the git wrapper on PATH: /usr/bin/git steps around it and no hook catches that, so only the forge\'s own branch protection would refuse main.' : ''}`, ['workflow'])
      : step(['s-harness', 's-guards', 'g-nft', ...out('net-github')], 'warn', 'git push origin main',
        'Allowed. local-only blocks no branches because it never pushes, and --allow-github-push gives it a push host anyway, so the guard has no branch to refuse. Only GitHub\'s own branch protection stands in the way.', ['workflow', 'ghpush']),
    step(['s-harness', 's-guards'], 'ok', 'git push origin agent/fix-tests', `To ${e.pushHosts.join(' or ')}, a push host. Allowed.`, ['workflow', 'forge', 'ghpush']),
    toForge,
    mergeStep,
    on.ci && e.pushes && step([...(cfg.ci_tiers !== 'privileged' ? ['r1-1', 'fw-ci-c'] : ['cip-runner', 'fw-ci-p']), 'lan-forge'], 'warn', 'The push queues CI',
      'A runner picks the job up when it next asks the forge for work. Push access is code execution on whatever runner the repo reaches. That is what the CI hardener is for.', ['workflow']),
  ];
  add('dejima', 'push', 'Push a branch', guard(pushSteps));

  // Escape
  add('dejima', 'escape', 'Escape the container', guard([
    step(['s-harness', 'c-session'], 'info', 'Suppose a kernel bug lets it out', 'A container escape is in the threat model, not the end of it. The question is what lies under the container.', []),
    dv ? step(['dejima-host', 'fw-devbox'], 'refused', 'Go looking on the LAN', 'Now on the devbox as the launching user, which is in the docker group, so root is one docker run away. It tries the NAS. Rules 7-9 drop it on the node, where the guest cannot reach, and log it to pve-firewall.log.', [])
      : step(['dejima-host', 'lan-nas'], 'warn', 'Go looking on the LAN', 'On a laptop, nothing below the container bounds it. It has your user, your home directory, and your LAN.', []),
    dv && step(['fw-devbox', 'pve-log'], 'info', 'The drop is logged', 'Written by the hypervisor. A quiet log going loud is the strongest signal you get. Nothing in either repo reads it for you.', []),
    dv && step(['dejima-host', 'fw-devbox', 'lan-router', 'net-unlisted'], 'warn', 'The internet is still open', 'The devbox reaches public IPv4 on any port, by its outbound ACCEPT policy. The wall is around your LAN, not around the internet.', []),
    on.guard && step(['gd-cycle', ...nodeFw, 'p-guardshell'], 'info', 'About every 15 minutes, the guard looks', 'A changed critical path, a new unit or listener, or changes alongside a failed reach alert at max; other changes, or a failed reach alone, at high. Unless the payload thought to forge the state.', []),
  ]));

  // Close
  const iso = e.isolated === 'on';
  add('dejima', 'close', 'Close the session', guard([
    step(['c-session'], 'info', 'The session container is removed', 'compose run --rm: its filesystem is gone.', [], { gone: ['c-session'] }),
    e.proxied && step(['p-proxy'], 'info', 'The proxy stops', 'Its log is summarised on your terminal, when there is anything in it: errors, auth failures, and what to do about them.', [], { gone: ['p-proxy', 'p-shipper'] }),
    step(['p-launcher'], 'info', 'The per-run copies are deleted', 'Host-side temp files that were bind-mounted in: the staged ~/.claude.json, the gitconfig copy, the settings overlay, any fake credential, the proxy\'s socket directory.', []),
    step(['c-filter'], 'info', 'The filter and the network go', 'docker rm -f the filter, docker network rm dejima-run-…. Live dejima-allow --container grants die with them.', [], { gone: ['docker'] }),
    iso && step(['f-project'], 'info', 'The session\'s volumes are removed', 'The work volume and its history and editor volumes: an isolated session keeps nothing it was not told to.', [], { gone: ['f-project'] }),
    step(['p-launcher'], 'info', 'Image tags are released', 'This run\'s tags are dropped and unreferenced layers reclaimed.', []),
    iso && step(['f-share'], 'info', 'An empty share is removed', 'Only if the agent left nothing in it.', []),
    e.epitaph === 'on' && (cline
      ? step(['p-launcher'], 'info', 'No epitaph to save', 'cline\'s adapter extracts no compaction summaries, so there is nothing for the epitaph store.', ['epitaph', 'harness'])
      : step(['p-launcher', 'f-stores'], 'ok', 'The epitaph is saved', 'If the session compacted, its summaries are copied host-side, to the epitaph store.', ['epitaph'])),
    !iso && step(['p-launcher', 'f-project'], 'info', 'The exit-time audit runs', 'It diffs .git/config, hooks, .mcp.json, .envrc, and friends against the launch snapshot. A new core.hooksPath or credential.helper is CRITICAL.', []),
    step(['f-share'], 'ok', 'What is left',
      iso ? `The share, if the agent wrote to it.${e.keep === 'on' ? ' --keep-records also kept the epitaph.' : ''}${e.loki !== 'unset' ? ' Its lookups and connections, at Loki.' : ''}`
        : 'The project, ~/shared, writable mounts, the harness\'s per-project state, epitaphs, and the audit record.', [],
      { kept: ['f-project', 'f-share', 'f-rw', 'f-rwpp', 'f-stores'].filter(x => !(iso && x === 'f-project')) }),
  ]));

  // ---- remote access ----------------------------------------------------
  if (on.remote) {
    const web = cfg.ra_doors !== 'ssh', ssh = cfg.ra_doors !== 'web';
    const dropped = dv && cfg.dv_6b === 'off';
    if (cfg.ra_ntfy !== 'unset') add('remote', 'ra-notify', 'Get a push when it finishes', guard(cline ? [
      step(['s-harness'], 'info', 'No Stop hook', 'cline hosts none of dejima\'s hooks, so nothing writes a marker and no push goes out. The marker directory is still mounted, so a session could write one by hand and send a real push.', ['harness']),
    ] : [
      step(['s-harness', 'm-notify', 'p-notify'], 'ok', 'The Stop hook writes a marker', 'An empty file named done. That is all the session can say: the push never carries what it wants.', ['harness']),
      step(['p-notify', ...(dv ? ['fw-devbox'] : []), ...(dropped ? [] : ['lan-ntfy'])], dropped ? 'refused' : 'ok', 'POST to ntfy',
        dv ? (dropped ? 'notify-watch runs on the VM, so its post is LAN traffic: rule 7 drops it. The phone never buzzes; the traces are a "push failed" line in the unit\'s journal and a drop in pve-firewall.log.' : 'Rule 6b opens tcp/8443 to the ntfy-only listener, above the DROPs.')
          : 'From the host, outside the container\'s allowlist.', ['ra_ntfy', 'dv_6b']),
      !dropped && step(['lan-ntfy', 'ph-ntfy'], 'ok', '"dejima: proj finished"',
        cfg.ra_base === 'unset' ? 'No base_url, so there is no link to tap.' : web ? 'Tap opens https://dejima.example.lan/?arg=<run id>.' : 'base_url is set, so the push links to a web front door that was never set up.', ['ra_base']),
    ]));
    if (web) add('remote', 'ra-web', 'Attach from the phone, web', guard([
      step(['ph-web', ...nodeFw, 'p-nginx'], 'ok', 'TLS, then Basic auth', dv ? 'Node rule 2 admits the front-door subnet, the narrower list: Basic auth has no lockout and no second factor.' : 'No node firewall: anyone on your LAN can try the password.', ['ra_doors']),
      step(['p-nginx', 'p-ttyd'], 'ok', 'To ttyd on loopback', 'proxy_pass http://127.0.0.1:7681. --check-origin refuses a WebSocket opened by another site.', []),
      step(['p-ttyd', 'p-attach'], 'ok', '?arg=<run id>', 'ttyd passes the run id to dejima-attach, which checks it is 16 hex characters.', []),
      step(['p-attach', 's-harness'], 'ok', 'Attached', 'A throwaway grouped tmux session on that window. SESS goes back to the picker without reloading.', []),
    ]));
    if (ssh) add('remote', 'ra-ssh', 'Attach from the phone, SSH', guard([
      step(['ph-ssh', ...nodeFw, 'p-sshd'], 'ok', 'SSH with the phone key', dv ? 'Node rule 1 admits the admin subnets only, so the phone has to be on one; the front-door subnet gets the web door and nothing else.' : 'sshd on the laptop.', ['ra_doors']),
      step(['p-sshd', 'p-attach'], 'ok', 'The forced command runs', 'restrict,pty,command="…/dejima-attach": whatever the client asked for, it gets the picker.', []),
      step(['p-attach', 's-harness'], 'ok', 'Pick a number', `  1  ● proj  ${cline ? 'attachable' : 'waiting'}  4m. Type 1 and Enter, and you are in.`, []),
    ]));
    add('remote', 'ra-lan', 'Someone else on the LAN tries the door', [
      dv ? step(['lan-nas', 'fw-devbox'], 'refused', 'Dropped at the node', 'Not in the front-door or admin subnet: inbound policy DROP.', [])
        : step(['lan-nas', web ? 'p-nginx' : 'p-sshd'], 'warn', 'It reaches the door', 'dejima ships no host firewall: on a laptop the perimeter is "on my LAN", unless you run one. The door\'s own auth is the gate.', []),
    ]);
    add('remote', 'ra-sandbox', 'The session tries the front door', guard([
      fw ? step(['s-harness', 'g-nft'], 'refused', 'Connect to 10.0.0.24:443', 'A host address on a port nobody opened: the clamp refuses it.', ['firewall'])
        : step(['s-harness', 'bridge', 'p-nginx'], 'warn', 'Connect to 10.0.0.24:443', 'With the firewall off nothing keeps it out: the host delivers a packet for its own LAN address locally. Only nginx\'s auth stands between the session and a host shell.', ['firewall']),
    ]));
  }

  // ---- devbox-hardener --------------------------------------------------
  if (dv) {
    add('devbox', 'dv-reach', 'The hourly reach audit', [
      step(['p-audit', 'fw-devbox'], 'refused', 'Probe the gateway on 443, 80, 22', 'Rule 7 drops them at the node, and that silence is what the audit wants. A REJECT would answer, and read as FAIL.', []),
      step(['p-audit', 'fw-devbox', 'lan-resolver'], 'ok', 'Positive control', 'The forge\'s name resolves, through rules 5-6; if it did not, a handshake to the forge on 443 (rule 3). So the silence means blocked, not offline.', []),
      step(['p-audit', 'fw-devbox'], 'refused', 'Then IPv6', 'A global or ULA address would be FAIL outright. With none, it pings ff02::1, and rule 12 drops that too.', []),
      step(['p-audit'], 'ok', 'PASS', 'Every probe timed out and a control worked: exit 0. A forge listed in /etc/hosts would pass the control with no network at all.', []),
    ]);
    add('devbox', 'dv-in', 'A LAN host tries SSH into the devbox', [
      step(['lan-nas', 'fw-devbox'], 'refused', 'Inbound policy DROP', 'Only the admin subnets (and an off-subnet guard, by rule 2b) get 22; only the front-door subnets get the front door.', []),
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
          'Over the forge API with a read-only token, never from a checkout. A pull request cannot widen it: only what merged to main counts. Node rule 2. A repo with no such file contributes nothing.', ['ci_pools']),
        two && step(['ci-timer', 'fw-ci-c', 'lan-forge'], 'ok', 'GET every repo bob owns', 'bob is in repos_file as well as the pools file, and the token has read:user, so the owner expands through /users/bob/repos. Pool 2\'s set is the union of bob\'s non-mirror repos.', ['ci_pools']),
        step(['ci-timer', 'ci-dns'], 'ok', 'Write and test the dnsmasq file', 'server=/pypi.org/<upstream> and ipset=/pypi.org/ci-allow-1. It must pass dnsmasq --test; removed names flush the sets; dnsmasq restarts.', []),
        step(['ci-timer'], 'info', 'Any failure keeps the last list', 'A 401, a redirect, an invalid name, or an empty result all leave the previous allowlist in place.', []),
      ]);
      add('ci', 'ci-job', 'Run a confined job', [
        step(['r1-1', 'fw-ci-c', 'lan-forge'], 'ok', 'A runner polls for work', 'act_runner asks the forge over node rule 2, outbound; the job comes back on that connection. Only runners registered to a scope covering the repo, with a matching label, are offered it.', ['ci_count']),
        step(['r1-1', 'job-1'], 'ok', 'Start the job container', 'On dejima-ci1, --dns at the gateway, no Docker socket, NET_ADMIN and NET_RAW dropped.', []),
        step(['job-1', 'ci-dns'], 'ok', 'Look up pypi.org', 'alice/proj declares it on main, so it resolves and its addresses go into ci-allow-1.', ['ci_pools']),
        step(['job-1', 'ci-fwd', 'fw-ci-c', 'lan-router', 'net-pypi'], 'ok', 'Connect on 443', 'DEJIMA-CI-FWD accepts tcp 80/443 to the pool\'s set and the base set.', []),
        step(['job-1', 'ci-dns'], 'refused', 'Look up example.net', 'REFUSED: not on any list.', []),
        step(['job-1', 'ci-fwd'], 'refused', 'Try the NAS', 'REJECT in the VM, and rules 5-7 on the node behind it.', []),
      ]);
      if (two) add('ci', 'ci-cross', 'A job tries another pool\'s name', [
        step(['job-1', 'ci-dns'], 'warn', 'It resolves', 'Every pool shares one dnsmasq, so every job can resolve every allowlisted name.', ['ci_pools']),
        step(['job-1', 'ci-fwd'], 'refused', 'It cannot connect', 'The address went into ci-allow-2, and dejima-ci1\'s rules name only ci-allow-1 and base. The leak is names, not reach.', ['ci_pools']),
      ]);
      if (cfg.ci_count !== '1') add('ci', 'ci-neighbour', 'Two jobs in one pool', [
        step(['job-1', 'job-1b'], 'warn', 'They share a bridge', 'Jobs from every runner in a pool land on its bridge, and the docs say they can reach each other and each other\'s service containers. Whether the per-bridge REJECT catches it depends on the host\'s bridge-nf-call-iptables, which nothing in the repo sets. The runners themselves sit on their own network.', ['ci_count']),
      ]);
    }
    if (priv) add('ci', 'ci-priv', 'Run a privileged job', [
      step(['cip-runner', 'fw-ci-p', 'lan-forge'], 'ok', 'The one runner polls for work', 'runs-on: dejima-privileged, over node rule 2.', ['ci_tiers']),
      step(['cip-runner', 'cip-sock', 'cip-job'], 'ok', 'Start it with the socket', 'docker_host = "" mounts the socket; container.network = host gives it the VM\'s network.', []),
      step(['cip-job', 'cip-sock'], 'ok', 'docker build, docker run', 'What confined jobs cannot do: build images, boot containers, run dejima\'s runtime.bats.', []),
      step(['cip-job', 'fw-ci-p', 'lan-resolver'], 'warn', 'Any name resolves', 'Through the VM\'s own resolver, node rules 3-4: no allowlist, no rebind check, and DNS tunnelling is open.', []),
      step(['cip-job', 'fw-ci-p', 'lan-router', 'net-unlisted'], 'ok', 'Any public address', 'No allowlist in this VM. A job holding the socket could flush one, so none is pretended.', []),
      step(['cip-job', 'fw-ci-p'], 'refused', 'Try the NAS', 'Rules 5-7 on the node: it reaches the internet, not your network.', []),
    ]);
    add('ci', 'ci-rollback', 'Sunday 04:00', [
      conf && step(['pve-cron', 'vm-ci-c'], 'info', 'Roll back the confined VM', 'qm shutdown, qm rollback <vmid> clean, qm start. The allowlist timer re-renders 2 to 3 minutes after boot.', []),
      priv && step(['pve-cron', 'vm-ci-p'], 'info', 'Roll back the privileged VM', 'Whatever a job left behind is gone.', []),
    ]);
  }

  // ---- guard ------------------------------------------------------------
  if (on.guard) {
    const win = cfg.gd_expect !== 'closed';
    const hb = cfg.gd_hb !== 'unset';
    const ntfy = cfg.gd_alert === 'ntfy_url';
    const alertTo = ntfy ? ['lan-ntfy', 'ph-ntfy'] : ['gd-cycle'];
    const alert = (title, pri, body) => step(['gd-cycle', ...alertTo], 'ok', `Alert: ${title}`,
      `${ntfy ? `At ${pri} priority` : 'alert_command gets the title and body on stdin, with no priority'}${body ? `: ${body}` : '.'} No paths or unit names in it; the detail stays in dejima-guard report, on the guard.`, ['gd_alert']);
    const after = step(['gd-cycle'], 'info', 'No heartbeat, and it repeats', `A cycle that alerted sends no heartbeat${hb ? '' : ' (and there is no heartbeat_url anyway)'}. check never moves the baseline, so the same finding alerts every 15 minutes until dejima-guard accept.`, ['gd_hb']);
    const collect = [
      step(['gd-cycle', 'fw-devbox', 'p-guardshell'], 'ok', 'SSH in with the guard key',
        `${cfg.gd_place === 'other segment' ? 'Node rule 2b, the guard\'s one address' : 'Node rule 1, from the admin subnet'}. The key's forced command is dejima-guard-shell, no-pty.`, ['gd_place']),
      step(['p-guardshell', 'p-audit'], 'ok', 'drift --state, then reach', 'The only two commands the forced command and sudoers allow.', []),
      step(['p-audit', 'p-guardshell', 'fw-devbox', 'gd-cycle'], 'ok', 'The state comes back', 'File hashes, symlinks, enabled units, listeners outside the ephemeral port range. Capped at 8 MiB.', []),
    ];
    const heartbeat = hb ? step(['gd-cycle', 'lan-kuma'], 'ok', 'Heartbeat', 'A cycle with nothing to alert sends this ping and no message. If the pings stop for 1200 s, Kuma fires.', ['gd_hb'])
      : step(['gd-cycle'], 'warn', 'No heartbeat_url', 'A guard that dies quietly looks the same as a devbox that is fine.', ['gd_hb']);
    add('guard', 'gd-clean', 'A scan: nothing changed', [
      ...collect,
      step(['gd-cycle', 'gd-baseline'], 'ok', 'Diff against its own baseline', 'Clean, and reach said PASS.', []),
      heartbeat,
    ]);
    add('guard', 'gd-keys', 'A scan: authorized_keys changed', [
      ...collect,
      step(['gd-cycle', 'gd-baseline'], 'refused', 'A watched path changed', 'authorized_keys is a critical path: alerted at max, never ignored, never held by a window.', ['gd_expect']),
      alert('watched path changed', 'max', '"2 line(s) changed under paths this guard treats as its own footing… Treat what it has reported since as unverified." An edited file is two diff lines, old and new'),
      after,
    ]);
    add('guard', 'gd-listener', 'A scan: a new listener', [
      ...collect,
      step(['gd-cycle', 'gd-baseline'], win ? 'info' : 'refused', win ? 'Held: the window is open' : 'A new PORT line', win ? 'dejima-guard expect opened a window. The change is held, and accepted when it closes.' : 'A new listener or unit alerts at max. One that went away counts as an ordinary change, at high.', ['gd_expect']),
      win ? heartbeat : alert('new listener or unit', 'max'),
      !win && after,
    ]);
    add('guard', 'gd-reach', 'A scan: reach fails', [
      ...collect,
      step(['gd-cycle', 'gd-baseline'], 'refused', 'Nothing changed, but reach did not pass', 'FAIL or INDETERMINATE: something answered, or no control worked. Inside a window too: containment is never held.', ['gd_expect']),
      alert('containment', 'high'),
      after,
    ]);
    add('guard', 'gd-down', 'The devbox stops answering', [
      step(['gd-cycle', 'fw-devbox'], 'refused', 'SSH times out', `After ssh_timeout = 10 s.${win ? ' Inside a window this is held, with no heartbeat either.' : ''}`, ['gd_expect']),
      win ? (hb ? step(['gd-cycle', 'lan-kuma'], 'warn', 'No heartbeat', 'Held is not clean: with the devbox gone for more than about 20 minutes, Kuma fires anyway.', ['gd_hb']) : null)
        : alert('unreachable', 'max', 'silence is a finding'),
    ]);
    add('guard', 'gd-pull', 'The devbox tries to reach the guard', [
      step(['dejima-host', 'fw-devbox'], 'refused', 'Dropped at the node', 'The guard is a LAN address, so rules 7-9 drop it (logged), and nothing on the guard listens anyway. The guard pulls; adding an outbound pinhole "for symmetry" would give that away.', []),
    ]);
  }

  // ---- darner -----------------------------------------------------------
  if (on.darner && cfg.dn_front.length) {
    const h = cfg.dn_harness === 'default' ? e.harness : cfg.dn_harness;
    const dnRefused = refusals(effective(normalise({ ...cfg, on: { ...cfg.on }, isolated: 'on', harness: h,
      drop: cfg.dn_net === 'default' ? 'off' : 'on', sealed: cfg.dn_net === 'sealed' ? 'on' : 'off' })));
    const refusedHere = dnRefused.length > 0;
    const matrix = cfg.dn_front.includes('maubot'), webUi = cfg.dn_front.includes('darner-web');
    const link = cfg.dn_ra !== 'unset';
    const netFlag = { default: '', named: ' --drop-domains', sealed: ' --require-sealed' }[cfg.dn_net];
    const hop = ['p-dn-api', ...nodeFw, 'p-dn-launch'];
    const middle = [
      step(hop, 'ok', 'ssh to the launcher', `${dv ? 'Through an inbound SSH rule for the API host: rule 1 if it sits on an admin subnet. ' : ''}The key is from="<API>",command="darner-launch …",restrict. The job arrives as JSON on stdin.`, []),
      refusedHere
        ? step(['p-dn-launch'], 'refused', `dejima --isolated${netFlag} refuses`, `${dnRefused.join(' ')} The tmux window dn-k3x7q opened, so the frontend first hears "Started"; on the next poll the task has exited, and it says "dn-k3x7q ended." with no reason. The reason waits in darner:dn-k3x7q, for Enter.`, ['dn_net', 'dn_harness', 'cline_model'])
        : step(['p-dn-launch', 'dn-harness'], 'ok', `dejima --isolated${netFlag}`, `In a tmux window named dn-k3x7q, with harness ${h}. An anonymous session: no project, a fresh ~/shared, global approvals only.${link ? ' The launch waits up to 20 s for dejima to register, so the reply can carry a remote-access link.' : ''}`, ['dn_net', 'dn_harness', 'dn_ra']),
      !refusedHere && step(['dn-harness', 'dn-share'], 'ok', 'RESULT.md, then .done', 'The prompt tells the agent how to deliver. A RESULT.md left without .done is still collected after 600 s of quiet, or when the session exits.', []),
      !refusedHere && step(hop, 'ok', 'Status poll', 'Every 30 s: ssh … status reports ready.', []),
      !refusedHere && step(['p-dn-launch', 'dn-share', 'p-dn-launch', ...nodeFw, 'p-dn-api'], 'ok', 'Fetch the zip', 'darner walks ~/shared by fd, regular files only, and builds the zip itself; the API rebuilds it again.', []),
    ];
    if (matrix) add('darner', 'dn-matrix', 'Send a task from Matrix', [
      step(['ph-matrix', 'net-matrix', 'mb-bot'], 'ok', '@dragonlet fix the flaky test', 'The sender must be on the bot\'s allowlist; anyone else is ignored silently. The bot reacts ⏳.', ['dn_front']),
      step(['mb-bot', 'p-dn-api'], 'ok', 'POST /v1/tasks', `With the bot's own bearer token. It replies "Started dn-k3x7q → darner:dn-k3x7q"${link ? ' and "Open the session: <link>"' : ''}, and reacts ✅. A task the API itself refuses gets "Failed: …" and ❌ instead.`, ['dn_ra']),
      ...middle,
      !refusedHere && step(['mb-bot', 'p-dn-api'], 'ok', 'GET /v1/events', 'The bot polls for events and acks each one.', []),
      !refusedHere && step(['mb-bot', 'net-matrix', 'ph-matrix'], 'ok', 'Output, threaded as a reply', '"Output from dn-k3x7q (written by the agent, treat as untrusted)" and the summary, then the zip in a second reply, encrypted in E2EE rooms.', []),
    ]);
    if (webUi) add('darner', 'dn-web', 'Start a task from darner-web', [
      step(['ph-web', 'dn-proxy', 'p-dn-web'], 'ok', 'Through the auth proxy', 'darner-web has no login. The proxy is the gate.', ['dn_front']),
      step(['p-dn-web', 'p-dn-api'], 'ok', 'POST /v1/tasks', 'After a live preview of its settings and where each comes from. dejima\'s own refusals cannot show there; they show only as the task ending.', []),
      ...middle,
      !refusedHere && step(['p-dn-api', 'p-dn-web', 'dn-proxy', 'ph-web'], 'ok', 'Summary and a download link', `Shown until you press Clear, or for 7 days (output_retention).${link ? ' The session also links to its window in remote access.' : ''}`, ['dn_ra']),
    ]);
    if (!refusedHere) add('darner', 'dn-help', 'The agent asks for help', [
      step(['dn-harness', 'dn-share'], 'ok', 'HELP.md, then .help', 'At most once per 300 s.', []),
      step([...hop, 'dn-share'], 'ok', 'Picked up by the next poll', 'A help event goes to the frontend that started the task.', []),
      cfg.dn_answers === 'on'
        ? step([...hop, 'dn-harness'], 'ok', 'Your answer is typed in', `--answers: pasted bracketed, control characters stripped, then Enter${h === 'cline' ? '; at cline\'s question prompt it is typed as keys, on one line' : ''}.`, ['dn_answers'])
        : step(['p-dn-api'], 'info', 'No answering from chat', `${matrix ? `Matrix says "Attach to darner:dn-k3x7q to respond"${link ? ', or links the session' : ''}, and a reply gets ❌. ` : ''}${webUi ? 'darner-web still shows an answer box, and sending is refused: answering from chat is not enabled on this host.' : ''}`, ['dn_answers', 'dn_ra']),
    ]);
  }

  return list;
}
