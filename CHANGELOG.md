# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**lagotto-ts stays on `0.x.y` indefinitely.** There is no planned 1.0.0, so
breaking changes bump the MINOR version — permanently, not as a pre-release
convention. Read a MINOR bump as "may break you" for the life of the project.

Its version line is **its own**, and deliberately not the Go tool's: at time of
writing lagotto-ts is 0.2.x against Go `lagotto` v0.51.x, and matching those
numbers would assert a feature correspondence that does not exist. Parity with Go
is a **behavioural** claim with documented divergences, tracked in
[#5](https://github.com/spore-host/lagotto-ts/issues/5) — never a claim that two
version strings agree.

## [Unreleased]

### Fixed
- **A pin's version comment can no longer silently misstate what CI runs.**
  `src/ci-hygiene.test.ts` required only that *some* `# vN` comment be present,
  never that it was true. A wrong label is worse than a missing one: it makes a
  major-version jump read as a routine same-line bump. Not hypothetical —
  Dependabot bumped nf-spawn's `checkout` pin to a **v7.0.1** SHA while leaving the
  comment reading `# v6`, and the identical pattern passed it. Two complementary
  halves now, because neither alone suffices: the test requires an exact `vX.Y.Z`
  (offline, hermetic — catches vague labels), and a new `scripts/verify-pins.sh`
  resolves each SHA against the tag its comment claims and fails if they disagree
  (needs the network, so it runs as its own CI step — catches exact-but-false
  labels the offline half cannot see). This repo's pins were already exact and
  true, so nothing needed relabelling; the gate is what changed.

### Security
- **Every GitHub Actions ref is now pinned to a commit SHA, with Dependabot to
  bump the pins** ([#10](https://github.com/spore-host/lagotto-ts/issues/10)). All 5 `uses:` refs were floating tags
  (`@v4`), and a tag is mutable — `@v4` means "whatever `v4` points at when the
  job runs." `actions/checkout@v6` genuinely moved (`df4cb1c` → `d23441a`) with no
  signal to consumers, so this is not hypothetical.
  - It matters most in `publish.yml`, which uses **npm Trusted Publishing**:
    `id-token: write` + OIDC authorizes publishing `@spore-host/lagotto-ts`, so whatever runs in
    that job can publish as us — and unlike a leaked `NPM_TOKEN` there is nothing
    to rotate afterward. Nothing in this repo sat between an upstream tag being
    repointed and code executing with that authority.
  - A SHA alone would trade a mutable-tag hole for a staleness one — pins never
    move, including past a security fix — so a new `.github/dependabot.yml` bumps
    them weekly with a 7-day cooldown (a freshly published tag is exactly when a
    compromised one is still unnoticed) and covers `npm` dependencies too. Its
    group pattern is `*`, not `actions/*`, so the first action from outside
    `actions/` can't silently fall outside the group.
  - `src/ci-hygiene.test.ts` makes both halves regressions rather than
    conventions — reverting a pin or dropping the Dependabot entry now fails
    `npm test`. `yaml` becomes a dev dependency for it; `"files": ["dist"]` and the
    `tsconfig.build.json` test exclusion keep it out of the published package.
  No runtime change — CI wiring and tests only.

## [0.2.0] - 2026-07-31

Breaking, and MINOR because pre-1.0: `MatchResult.price` is now
`number | undefined`, because the release's central fix is that **an unknown price
is reported as unknown — never as `0`**. A zero read as free, so it passed every
price cap and won every "cheapest" comparison.

### Fixed

- **An unknown price no longer passes a price cap, or wins "cheapest".** Two
  places treated an absent `onDemandPrice` as `0`, and a zero is not a low
  price — it's a missing one that happens to sort first.
  - `evaluate` read `c.instanceType.onDemandPrice ?? 0`, so an unpriced offering
    satisfied **every** `maxPrice`: a watch saying *"wake me under $1/hr"* fired on
    a machine whose cost we can't establish, and the user learned the price from
    the bill. It now rejects an unpriced offering **when a cap is set**, and still
    matches it when no cap is — with no `maxPrice` the watch has expressed no price
    opinion, and refusing there would make a brand-new accelerator unwatchable.
  - `CapacityWatcher.check` compared `m.price < best.price`, so an unpriced match
    took the cheapest slot it had the least evidence for. A new `isCheaper` ranks a
    priced match above an unpriced one, keeping the unpriced one only when there's
    nothing else — sunk, not dropped, so a watch still reports capacity that
    genuinely exists.
- Both were **latent until truffle-ts 0.5.0**, which made an absent price the
  common case rather than a curiosity: it now omits the price for types it cannot
  establish instead of fabricating one (truffle-ts#39/#42). The bug was ours, but
  the honest upstream data is what exposed it.

### Changed

- **`MatchResult.price` is now optional (`number | undefined`)** — breaking for a
  consumer that indexed it as a required `number`. The required type was *forcing*
  the fabrication above: the matcher had no way to say "unpriced" except to invent
  a `0`. Render it as unknown, never as `0`. A Spot match always carries a price
  (the observation is why it matched); only the on-demand branch can leave it
  absent.
- `peerDependencies` widened to `@spore-host/truffle-ts@^0.4.0 || ^0.5.0`. The
  `^0.4.0` bound blocked `npm ci` for any consumer on 0.5.0 — including the
  spore.host portal, which depends on both. Nothing here imports truffle-ts (the
  adapter takes a structural type), so the bound was stale rather than protective.

## [0.1.0] - 2026-07-26

### Added

- Initial release — a browser-native TypeScript port of the spore.host `lagotto`
  capacity watcher, packaged as `@spore-host/lagotto-ts`.
- **Pure core** (default `.` entry, offline, no AWS/truffle-ts dependency):
  - `evaluate(watch, candidate)` — the capacity matcher (on-demand + Spot
    branches, price cap, AZ pin/order), ported from Go `pkg/watcher` `Evaluate`.
  - `wildcardToRegex` / `compilePattern` — instance-type glob→regex conversion.
  - `parseDuration` — short TTL strings (`7d`, `48h`, `1w`) → milliseconds.
  - `azAllowed` / `orderAZs` — availability-zone preference handling.
  - `parseCondition` — `--until` completion conditions: `http-200` and
    `s3-empty` (the Go `shell:` kind is intentionally not ported).
- **Live capacity watcher** (`./live` subpath, Node/CLI/server):
  - `CapacityWatcher` — `check()` (cheapest current match) and `poll()`
    (poll-while-open with abort + maxChecks), consuming a truffle-ts finder
    through a structural `CapacityFinder` seam.
- Packaging mirrors the sibling `-ts` libraries: subpath `exports` (`.` +
  `./live`), `build:lib`, `prepare`, Trusted-Publishing `publish.yml`, CI,
  TypeDoc.

[Unreleased]: https://github.com/spore-host/lagotto-ts/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/spore-host/lagotto-ts/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/spore-host/lagotto-ts/releases/tag/v0.1.0
