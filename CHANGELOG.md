# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0,
breaking changes bump the MINOR version.

## [Unreleased]

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

[Unreleased]: https://github.com/spore-host/lagotto-ts/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/spore-host/lagotto-ts/releases/tag/v0.1.0
