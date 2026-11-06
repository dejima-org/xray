# Security policy

## What dejima-xray is

A static page: HTML, styles, scripts, fonts, and images, served as files. It has no backend, holds no credentials, and stores nothing in the browser. The only request it makes is for its own `sources.json`. The settings a visitor picks live in the URL's fragment, which the browser never sends to the server.

So there is little here to compromise. If you find a way to make the page run script, load something from another site, or send anything a visitor chose, that is a vulnerability: report it as below.

## The risk is a wrong verdict

The picture says where dejima and its sister projects stop a request. If it says a request is refused when the code allows it, someone may rely on a boundary that isn't there. [docs/keeping-current.md](docs/keeping-current.md) is how the picture is checked against the code, and `verified/matrix.json` records every verdict that has been checked.

Report a verdict that disagrees with the code the same way as a vulnerability. If the picture is right and the code is the problem, that is a vulnerability in the project it describes, and the same address takes it.

## This is not proven software

Every verdict here is a claim, checked against the code by the people who wrote it, and nobody else has reviewed it. Read the code before relying on one.

## Reporting a vulnerability

Email **report@dejima.page**. Please don't open a public issue for a vulnerability; a report there is a disclosure.

The organisation-wide policy, including what you can expect in return and which versions are supported, is [dejima's SECURITY.md](https://gitbox.branderson.io/dejima/dejima/src/branch/main/SECURITY.md). In short: only the tip of `main`, which is what is served, is supported, and nothing is promised.

## No warranty

GPL-3.0-or-later, sections 15 and 16. This is provided as-is.
