# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# seo-audit — working notes

A zero-dependency CLI that crawls a site's sitemap and checks every page.
Public repo. Built because every free SEO grader audits only the homepage.

## Run it

```bash
node bin/seo-audit.mjs https://example.com               # terminal report
node bin/seo-audit.mjs https://example.com --html r.html --md r.md --json r.json
node bin/seo-audit.mjs https://example.com --psi https://example.com/
node bin/seo-audit.mjs https://example.com --psi "/journal/**" --psi-sample 3
node bin/seo-audit.mjs https://example.com --dry-run              # what it would crawl
node bin/seo-audit.mjs https://example.com --verbose              # watch it work
node bin/seo-audit.mjs --serve                                    # the web UI, locally
npm test                                                # no install, any platform
docker compose up --build                               # the same UI, in a container
```

Node 22 (`nvm use 22`). There is nothing to install and no build step.

One file, or one test, when the whole suite is not the question:

```bash
node --test test/unit.test.mjs
node --test --test-name-pattern="soft 404" test/unit.test.mjs
```

There is **one** suite now. `node --test` over `test/` is portable and needs
nothing installed, which is the premise. There used to be three — `swift test`
for the macOS app and `cargo test` for the Tauri shell, both needing toolchains
most machines touching this repo do not have, and both wrapped in a
`test:all` script that had to say plainly when it could not run one, because a
suite that was skipped reads exactly like a suite that passed. Those front ends
are gone and so is that problem.

`npm test` serves its own fixture site on localhost, so it works offline and
cannot be broken by a real site changing. It runs on Windows as well as Linux,
and `test.yml` covers both — running only ubuntu hid five real Windows failures
for months, every one of them found by running the suite there once. One test
is **skipped** on Windows with its reason stated: a piped stdin reports as
neither a FIFO nor a socket there, so the parent-death guard in
`bin/seo-audit.mjs` cannot see it.

The suite is necessary and not sufficient: every real bug this tool has ever had
was found by running it against a real site, so do that too before calling a
change done. Writing the tests found one immediately — `\b` treats the hyphen in
`data-src` as a word boundary, so a lazy-loading site had its `data-src` read as
its `src`.

## Three rules that are not negotiable

1. **No dependencies.** It must keep working with a bare `npx` on a machine
   with nothing installed. That rules out an HTML parser, a headless browser,
   and every convenience library. `src/parse.mjs` uses narrow regexes over
   well-formed generated markup on purpose.
2. **No false positives.** A check that cries wolf gets the entire report
   ignored. If a pattern is sometimes legitimate, it is an `info`, never an
   `error`. Cloudflare's `/cdn-cgi/l/email-protection` taught this one — it
   404s to non-browsers by design.
3. **Performance is never estimated.** A `fetch` loop cannot see rendering,
   and a plausible wrong number is worse than no number. `--psi` is not an
   exception to this: it asks Google for Google's own measurement.

## Where things live

The engine:

| File | |
|---|---|
| `bin/seo-audit.mjs` | CLI: flags, config merge, baseline compare, exit code |
| `src/audit.mjs` | Orchestration — discover sitemap, fetch pages, run checks |
| `src/http.mjs` | Fetching. Redirects are **not** followed; a redirect is a finding |
| `src/parse.mjs` | HTML extraction |
| `src/checks.mjs` | Per-page checks, and cross-page checks needing every page |
| `src/site.mjs` | Once-per-domain checks, link sweep, og:image reachability |
| `src/graph.mjs` | The internal link graph, built once — orphans, click depth, and the reach that orders the report |
| `src/dupes.mjs` | Pages whose body is another page again. MinHash sketches, because comparing every page with every other one is quadratic |
| `src/compare.mjs` | The same page fetched again as somebody else, for `--compare-as`. Compares what a search engine reads, never bytes |
| `src/robots.mjs` | robots.txt, as Google reads it — `Allow` beats `Disallow` on a longer pattern, and a tie goes to `Allow` |
| `src/dns.mjs` | DNS over HTTPS. **Not `node:dns`** — see the Worker section |
| `src/agents.mjs` | User-agent strings for `--browser` / `--os`; `agents-ai.mjs` asks robots.txt which answer engines are let in |
| `src/redirects.mjs` | A migration's redirect map, checked against the live site |
| `src/psi.mjs` | PageSpeed Insights |
| `src/console.mjs` | Search Console — the only thing here that needs an account |
| `src/config.mjs` | Config file, ignore rules, URL globs, schema expectations, portfolio resolution, and `readSecret` |
| `src/options.mjs` | Every flag, whether the window reaches it, and the control the served form draws for it |
| `src/prompt.mjs` | The questions asked when the bare command is run — never in CI |
| `src/text.mjs` | `plural()`. A sentence that cannot decide whether it is singular is a small version of the problem the reports are about |

What a run says, and what it writes:

| File | |
|---|---|
| `src/areas.mjs` | Which area a check belongs to. Severity says how loudly to complain; an area says who fixes it |
| `src/score.mjs` | The number out of 100, and the checks that passed to earn it. A counted checklist, not a prediction |
| `src/causes.mjs` | Findings grouped by the thing that has to change — the same check on pages of the same section is one piece of work, not 1,685 |
| `src/report.mjs` | Terminal, Markdown, HTML, the baseline diff view, and the portfolio table |
| `src/exports.mjs` | The list of formats and what a saved file is called — so a file downloaded from the page and one written by `--csv` cannot disagree |
| `src/sitemap.mjs` | The sitemap the site should have had. Refuses on a partial crawl rather than writing a short one |
| `src/llms.mjs` | The llms.txt, from strings the site already serves. Same refusal, same reason |
| `src/schema.mjs` | The JSON-LD it could add. **Every value is a string this crawl read**; where the evidence runs out the page is skipped and counted |
| `src/baseline.mjs` | Serialise and diff runs |

The front ends. There are two, they are the same page, and a report that
differs between them is a bug:

| File | |
|---|---|
| `src/serve.mjs` | `--serve`: thirty lines of `node:http` ↔ fetch adapter in front of `worker/index.mjs`, which is why that file is web-standard |
| `src/library.mjs` | Runs kept on disk. `libraryRoot()` reads `SEO_AUDIT_HOME` before anything else, which is the container's mount point. `kept.mjs` is the pure half, because the Worker has no filesystem to import |
| `worker/index.mjs` | The hosted front end, and the served one. Imports `audit` and `html`; re-implements nothing |
| `Dockerfile`, `docker-compose.yml` | The web UI packaged. No build step and no `npm ci` — the image is a Node and the source tree |

There used to be three more: a macOS app, a Tauri shell for Windows and Linux,
and a Raycast extension. All three were webviews around `--serve`, so deleting
them removed no capability from the page they were drawing. What they did take
with them is a set of tests that read Swift and Rust source; the contract those
guarded now reads `worker/index.mjs` instead, which is the file the page
actually talks to.

## Adding a check

Return `{ level, id, title, detail, url }` from the right place — that is the
whole contract. Per-page goes in `pageChecks`, anything needing the full set
in `crossPageChecks`, anything once-per-domain in `src/site.mjs`.

Then, in the same change. The first two are enforced by `npm test`:

1. **A category in `src/areas.mjs`.** Without one the finding lands in
   "Other" and the grouped report quietly stops being useful.
2. **An entry in `src/score.mjs`** — `CHECKLIST`, with a `worst` matching the
   level it is actually emitted at, a `scope`, and a sentence describing what
   passing looks like; or `NOT_SCORED`, with a reason rather than a shrug. A
   check that only ever fires as `info` must be in neither.
3. **A test in `test/unit.test.mjs`** — including a case proving it does
   **not** fire when it shouldn't, which is the half that matters.
4. **The row in the README's check table, and a `CHANGELOG.md` entry.** The
   README table is the tool's documentation of record and drifts immediately
   if this is skipped.

`scripts/check-levels.mjs` is what makes (1) and (2) enforceable: it reads the
levels back out of `src/` with regexes rather than running the checks, because
most of them only fire on a site that has the fault and a fixture with all 162
faults is a fixture nobody would maintain. Promoting a check from `warn` to
`error` and leaving its weight alone fails the suite. So does an entry for a
check nothing emits any more — it would sit in "passing" for ever, which is a
claim the tool cannot back up.

If the check reaches for a Node built-in, it will vanish in the Worker — read
the Worker section before you write it.

## Adding a flag

Three places, and the third is enforced.

1. `bin/seo-audit.mjs` — parse it, and add it to the help text.
2. `action.yml` — as an input *and* in the `args+=` block that assembles the
   command. An input that never reaches the CLI is worse than no input, because
   it fails silently. **Server-only flags are the exception**: `--serve`,
   `--no-open` and `--host` are absent from `action.yml` on purpose, because the
   action runs a crawl and exits, so a flag about a socket has nothing to mean
   there. An exception, not an oversight — write it down if you add another.
3. `src/options.mjs` — say whether the window should reach it. `app: true` if it
   does; otherwise a **sentence** saying why not. "Not yet" is a fine answer as
   long as it is written down and says something — the test rejects a bare
   `'not yet'`. A `field` beside it is what draws the control in the served
   form, so adding the flag adds the input; a flag with no `field` is simply not
   offered, which is a decision written down next to the flag it is about.

`npm test` fails until (3) is done, in both directions: a flag with no entry, an
entry for a flag that no longer exists, an entry claiming the page sends a
parameter that `worker/index.mjs` never reads, and a parameter the worker reads
that no flag corresponds to. That last one is a setting that quietly does
nothing, which is the worst of the four.

The test reads `worker/index.mjs` rather than comparing the table with
`formFields()`, and that is the whole point: `formFields()` is generated *from*
the table, so the two agreeing proves nothing. The worker is written separately
by hand, which is what makes it worth reading. It used to read Swift source for
the same reason, back when a native window was the thing being kept honest.

Watch the regex if you touch it. It matches `.get('name')` rather than
`searchParams.get('name')`, because half the run parameters are read inside
helpers — `psiOptions()`, `hostOptions()`, `searchConsoleProperty()`,
`agentFor()` — that take the searchParams under another name. The qualified
form missed eight of the sixteen and reported them as broken. The looser one
also picks up headers and other endpoints' parameters, which is what
`NOT_RUN_PARAMETERS` is for: a listed exception has to be looked at, a
pattern-matched one does not.

The table is served at `/options` as well, so "can the page do X" is a question
with a fetchable answer rather than one that needs a source file read.

## The hosted Worker

Optional, and not on the main path — the CLI is. Two rules keep it honest:

1. **It never re-implements a check.** It imports `audit` and `html`. If a
   report from the Worker can differ from a report from the CLI, that is a bug.
2. **When it cannot run a check, it says so in the report.** `tls-expiring` and
   `tls-expired` need a socket the runtime does not have, so a `tls-not-checked`
   note goes into every hosted report. A missing finding reads exactly like a
   passing one. Anything else that turns out not to work there gets the same
   treatment, never a silent omission.

Which is why `src/dns.mjs` resolves over DoH instead of `node:dns`: the obvious
module does not exist in the Workers runtime, so anything built on it would
vanish from every hosted report and have to apologise for itself the way TLS
does. DoH is a `fetch` and a JSON body, so the CLI, the Worker and both shells
ask the same resolver the same question — Cloudflare's, not as a preference but
because `dns.google` refused a plain fetch outright. Prefer that shape over the
apology whenever there is a choice.

`worker/` is deliberately absent from `files` in `package.json`: the npx payload
stays the CLI, and both deploy flows — Cloudflare and the container — clone or
copy the repository anyway. Wrangler is never a dependency; Cloudflare runs
`npx wrangler deploy` on their side. To try it locally you need Node 22
(wrangler refuses below that, even though the CLI itself is happy on 18):

```bash
npx wrangler dev --var AUDIT_TOKEN:whatever ALLOWED_HOSTS:example.com
npx wrangler deploy --dry-run     # proves the bundle still builds
```

Costs, limits and the risk statement live in `docs/hosting.md`. Numbers there
are dated and sourced; if you change one, re-check it against Cloudflare's
pricing page rather than trusting the sentence you are editing.

## The container

```bash
docker compose up --build     # http://localhost:4321
```

No build stage and no `npm ci`, because there are no dependencies: the image is
a Node and the source tree. `SEO_AUDIT_HOME=/data` is what the volume mounts at
— `libraryRoot()` reads it before anything else, so kept runs survive the
container.

Three things about it are load-bearing, and each of them has a way of looking
like something else when it breaks:

1. **`--host 0.0.0.0` in the `CMD` is not optional.** `serve()` defaults to
   `127.0.0.1`, which inside a container means the published port answers
   nothing at all.
2. **What makes that safe is `ports: ['127.0.0.1:4321:4321']`, not the flag.**
   `serve()` mints a random `AUDIT_TOKEN` per start and injects it into every
   request, so `authorized()` always passes — the local server has no password
   by design, and `ALLOW_PSI`, `ALLOW_SEARCH_CONSOLE` and `ALLOW_HOSTS` are set
   *because* it was assumed to be loopback-bound. Publishing this to `0.0.0.0`
   hands anyone who can reach it a crawler, with the owner's PageSpeed quota
   and Search Console credentials attached. Doing that safely means changing
   `serve.mjs` first — token from the environment, `ALLOW_*` opt-in — not
   changing the compose line. `--serve` now prints a different sentence when it
   is not on a loopback address, because "Nothing leaves this machine" was a
   claim and it stopped being true.
3. **Never add `stdin_open` to the compose file.** `bin/seo-audit.mjs` shuts the
   server down when stdin is a pipe, which is how the old native shells signalled
   that their window had closed. Compose gives a container `/dev/null` — a
   character device, not a pipe — so the server stays up. With `stdin_open: true`
   it would exit the instant it started, and that reads exactly like a crash.

## Releasing

```bash
# bump version in package.json, write the CHANGELOG entry, then:
git tag -a v1.41.0 -m "…" && git push --follow-tags
git tag -f -a v1 -m "…" && git push -f origin v1   # only if compatible
```

One file carries the version now — `package.json`. It used to be four, because
the bundled shells each carried their own and refused to start when theirs and
the engine's disagreed; the image tags come from the git tag instead, so all
the suite still checks is that the version is a shape `docker/metadata-action`
can read as semver.

Pushing the version tag runs one workflow, `Release`, and it needs no hand. It
calls `test.yml` as a reusable workflow first — a tag is not by itself evidence
that the code is healthy — and then builds `linux/amd64` and `linux/arm64` and
pushes to `ghcr.io/nurkamol/seo-audit`, tagged `{{version}}`, `{{major}}.{{minor}}`,
`{{major}}` and `latest`.

**Nothing creates a GitHub Release any more**, and nothing publishes to npm.
Those were the macOS and npm jobs. `npx github:nurkamol/seo-audit` still works,
because that clones the repository rather than fetching a published package.

The tag pattern is `'v[0-9]+.[0-9]+.[0-9]+'`, not `v*`, and this is enforced:
`v1` floats forward with every backwards-compatible release, so `v*` matches it,
and force-pushing `v1` would start a second full build for a version that does
not exist. `test/workflows.test.mjs` fails on a bare `v*` and names the shape to
use instead.

`v1` still matters even with the shells gone, because `action.yml` is still
here and projects reference `uses: nurkamol/seo-audit@v1`. A breaking change — a
renamed flag, a different exit code, a changed config shape — becomes `v2`, and
`v1` stops moving. Do not move `v1` past a breaking change.

`test/workflows.test.mjs` reads the workflow YAML as text — no parser, no
dependency — for mistakes that have no symptom until a tag is already pushed and
something has half published.

## Secrets

Everything reads the environment first and `~/.config/seo-audit/.env` second,
through `readSecret` in `src/config.mjs`. That file is deliberately outside this
repository because it is public.

| | |
|---|---|
| `PSI_API_KEY` | PageSpeed Insights, for `--psi` |
| `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN` | Search Console, for `--search-console` |

Never commit a key, and never paste one into an issue or a report. The hosted
front end gates both behind deployment variables — one spends somebody's quota
and the other reads somebody's account, so neither control is drawn unless the
deployment has said those are the visitor's own to spend.

## Context

Written after three commercial graders all reported a client site's homepage
as healthy while the language switcher on every translated article linked to
a 404 — a bug none of them could see, because it was only wrong on pages they
never opened. That is the tool's reason to exist; keep it in mind when
weighing whether a proposed check is worth the noise it will make.

Client URLs do not belong in this repository. The example in the README and
the self-check workflow point at sites chosen for that purpose.
