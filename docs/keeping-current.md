# Keeping the picture current

The picture makes claims about security boundaries, so a claim that has drifted from the code is a defect, not a rough edge. This is how it stays matched to the projects without re-reading all of them every time one changes.

`sources.json` records what the picture was checked against: a release for dejima, and for darner once it has one, and a commit for each project that doesn't release. The page shows the dejima release in its header and every pin at the foot of the settings rail. The picture follows releases on `main`, not `development`: `development` moves daily, and what an operator runs is a release.

## When to update

- **A dejima release** (a date tag on `main`): always.
- **A darner release**: always. Each darner release names the dejima release it was released against. Prefer a darner release made against the dejima release the picture shows. If the newest darner is against an older dejima, keep the darner pin and say so in the commit.
- **ci-hardener, devbox-hardener, guard**: these have no changelog and no release tags yet. Check them at every dejima release, and update when their `main` has moved.

`make sources` says which pins have fallen behind. It needs read access to the forge; `XRAY_FORGE=git@<forge>:` points it at an SSH remote instead of the public HTTPS one.

## 1. Triage

This is the cheap step, and most updates end here.

**dejima and darner:** read the changelog entries between the pinned release and the new one. **The others:** read `git log --stat <pinned>..main` for the paths that carry behaviour:

| project | paths |
|---|---|
| dejima-ci-hardener | `bin/` `install.sh` `etc/` `examples/` `proxmox/` `systemd/` |
| dejima-devbox-hardener | `bin/` `etc/` `proxmox/` `systemd/` |
| dejima-guard | `bin/` `etc/` `systemd/` `Dockerfile` `docker-compose.example.yml` |

Skim their `docs/` changes too: rule numbers and quoted strings live there.

For each entry, ask whether it changes something the picture draws:

- **a setting:** its name, options, default, or effect (`KEYS` in `src/config.js`);
- **a launch refusal**, or the order refusals are checked in (`refusal()`);
- **the permitted names**, the resolver, the firewall, or the host clamp (`permitted()`, `exempt()`, and the network scenarios);
- **mounts**, credentials, and what persists or goes at close;
- **workflows, forges, and guards:** push and merge rules, and which harness hosts what;
- **remote access**, notify, and the front doors;
- **a sister project's topology**, rules, alerts, or quoted strings.

## 2. Nothing drawn changes

Move the pin in `sources.json` (release or commit, and `verified`), and commit. List the entries reviewed in the commit message, so the next person can see the release was read and not skipped.

## 3. Something drawn changes

1. Change the model, run `make test`, and look at it in a browser, on a phone too.
2. Run `make unverified`. It writes `unverified.md`: every row of the verdict matrix that is not in `verified/matrix.json`. Those are the rows the change added or reworded.
3. Add the rows a release could have made wrong without the model changing: the existing rows of every scenario in an area the release touched. `node tools/matrix.mjs` prints the whole matrix as JSON to filter.
4. Verify those rows against the code at the new pin, using the prompt below. Use one verifier per project area, and split any area with more than about 150 rows.
5. Fix what is wrong, and repeat from step 2 until every row in `unverified.md` has been confirmed.
6. Only then refresh the snapshot with `node tools/matrix.mjs > verified/matrix.json`, move the pin, and commit both together.

The snapshot must only ever hold rows someone checked. Regenerating it to make the diff go away defeats the point of having it.

**Re-verify everything** when a release restructures an area (the egress policy, the launch sequence, a hardener's rule set), or after several releases have each been triaged as "nothing drawn changes". `echo '[]' > /tmp/none.json && node tools/matrix.mjs --diff /tmp/none.json` gives every row.

## 4. Tag it

After the change merges, tag `main` with the dejima release it reflects, as `dejima-<release>` (for example `dejima-2026.11.04`). The picture as it was for any dejima release can then be found, even after it has moved on. These tags stay on the forge: dejima's GitHub mirror publishes only tags named like a release, so the GitHub copy carries `main` alone.

## The verification prompt

Give each verifier its rows and this, with `<...>` filled in:

> You are verifying rows of dejima-xray, an interactive diagram of <area>, against the real code. Every verdict it shows has to be what the code actually does. Do not modify any files except your report.
>
> The rows are in <file>. Each is a scenario step: a verdict (ok = allowed and delivered; refused = stopped at the last node of the path; warn = allowed, with a caveat; info = no traffic decision), the smallest configuration producing it (a diff from the defaults; the header lists the config ids; +project means that project is on, and without +devbox dejima runs on a laptop), the path drawn, and the explanation shown, quoted strings included.
>
> Ground truth is <repo> at <pinned ref> (`git show <ref>:<path>` reads a file at it). Code wins over docs. Where they disagree, report both. The model is in src/ (config.js, topology.js, scenarios.js).
>
> For every row, decide CORRECT, WRONG, or UNVERIFIABLE for: the verdict, where it stops, whether a launch would get that far, and every factual claim. Cite file:line. Then list missing branches: settings that change a real outcome which the model ignores.
>
> Write the report to <path>. List WRONG first (row, what it says, what the source says, the correction), then UNVERIFIABLE, then missing branches, then the CORRECT row numbers.

When a verifier finds the code disagreeing with its own docs, or a defect in the project itself, file an issue on that project. The picture shows what the code does; the issue is how the project hears about it.

## What the picture assumes

These are stated in the settings' descriptions too. A verifier should treat them as given:

- With `forge = gitea`, `[forge.gitea] ssh_host`, `api`, and `token_file` are set. With `forge = github`, `push_token_file` is.
- The openrouter backend's `credential_file` is set.
- An SSH agent is running on the host.
- LAN addresses are private-range examples (`10.0.0.0/24`), because dejima's private-answer refusal and the hardeners' DROP rules only act on private ranges.
