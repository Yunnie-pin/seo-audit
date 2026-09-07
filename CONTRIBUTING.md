# Contributing

```bash
git clone https://github.com/nurkamol/seo-audit && cd seo-audit
npm test                                   # no install needed
node bin/seo-audit.mjs https://example.com
node bin/seo-audit.mjs --serve             # the web UI, on http://localhost:4321
```

There is nothing to install and no build step. The test suite serves its own
fixture site over localhost, so it runs offline and never depends on a real
site staying broken in the same way.

## Adding a check

Return `{ level, id, title, detail, url }` from one of three places:

| Where | For |
|---|---|
| `pageChecks` in `src/checks.mjs` | Needs only this page |
| `crossPageChecks` in `src/checks.mjs` | Needs every page at once |
| `src/site.mjs` | Once per domain, or needs the link graph |

Then, in the same change. The first two are enforced by `npm test`, which reads
the source to do it — so the failure lands on the machine of whoever added the
check, not on somebody else's hours later:

1. **A category in `src/areas.mjs`.** Without one it lands in "Other" and the
   grouped report quietly stops being useful.
2. **An entry in `src/score.mjs`** — `CHECKLIST`, with a `worst` matching the
   level it is actually emitted at, a `scope`, and a sentence for what passing
   looks like; or `NOT_SCORED`, with a reason rather than a shrug. A check that
   only ever fires as `info` belongs in neither.
3. **A test in `test/unit.test.mjs`** — with a case that proves it does **not**
   fire when it shouldn't, which is the half that matters.
4. **A row in the README's check table, and a line in `CHANGELOG.md`.**

`scripts/check-levels.mjs` is what makes (1) and (2) enforceable. Promoting a
check from `warn` to `error` and leaving its weight alone fails the suite, and
so does an entry for a check nothing emits any more — that would sit in
"passing" for ever, which is a claim the tool cannot back up.

## The three rules

1. **No dependencies.** It has to keep working with a bare `npx` on a machine
   with nothing installed. That rules out an HTML parser and a headless
   browser, and it is why `src/parse.mjs` is careful regexes.
2. **No false positives.** A check that cries wolf gets the whole report
   ignored. If a pattern is sometimes legitimate it is an `info`, never an
   `error`. When a real site produces a finding that is technically true and
   practically useless — footer headings counted in a page's outline, say —
   that is a bug in the check.
3. **Performance is never estimated.** `--psi` asks Google. A `fetch` loop
   cannot see rendering, and a confident wrong number is worse than silence.

## Severity

| | |
|---|---|
| `error` | Wrong, and costing traffic or breaking something |
| `warn` | Worth fixing, judgement involved |
| `info` | Worth knowing, may well be deliberate |

If you are unsure, it is one level lower than you think.
