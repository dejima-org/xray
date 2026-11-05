# dejima-viz

An interactive diagram of what dejima and its sister projects do: which component runs where, which wall bounds it, and where each request is stopped. Turn on a sister project or change a setting and the picture redraws at once. Pick something to happen and a packet walks its real path, with each hop explained.

Settings are named as you would write them (`[core] internal_domains`, `--require-sealed`, `/etc/dejima-ci/pools`). Choices are fixed example values, not free text. The URL carries the current configuration, so a link reproduces the picture.

## Preview

```sh
make serve
```

Then open `http://localhost:8000`. `make check` builds `public/` and fails if anything the page references is missing. `make test` runs the model's tests.

## How it is put together

A static page with no build step and no dependencies.

- `src/config.js`: every setting, with its real name, where it lives, its options, and what it changes. It also holds the launch refusals dejima itself would print.
- `src/topology.js`: `derive(config)` returns the containment tree (zones, machines, VMs, networks, containers, and what runs in them) and the static links between them.
- `src/scenarios.js`: `scenarios(config, derived)` returns what can be played. Each step is a path of node ids and a verdict.
- `src/render.js`: draws the tree as nested elements laid out by CSS, plus an SVG overlay for links and packets.
- `src/main.js`: the settings rail, the scenario player, and the inspector.

The tests in `test/` generate configurations and check that every path and link names something drawn, that a refused packet never reaches its destination, and that refusals match dejima's documented ones.

## Addresses

LAN addresses are private-range examples (`10.0.0.0/24`), because dejima's private-address refusal and both hardeners' firewall rules key on private ranges. Public addresses are RFC 5737 documentation addresses.

## Assets

- `assets/brand/` holds the dejima wordmark and favicon, copied unmodified from the dejima repository. They are trademarks and not covered by any licence in this repository.
- `assets/fonts/` holds Latin subsets of Jost, IBM Plex Serif, and JetBrains Mono from [Fontsource](https://fontsource.org), self-hosted. Each is under the SIL Open Font License; the licence files sit beside them.
