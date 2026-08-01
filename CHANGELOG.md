# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0,
breaking changes bump the MINOR version.

## [Unreleased]

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
