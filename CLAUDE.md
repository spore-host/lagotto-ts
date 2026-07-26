# CLAUDE.md — lagotto-ts

`lagotto-ts` is the browser-native TypeScript port of the spore.host
[`lagotto`](https://github.com/spore-host/lagotto) capacity watcher: match
instance-type patterns against live EC2 availability and report when capacity
appears. Sibling to [`spawn-ts`](https://github.com/spore-host/spawn-ts) and
[`truffle-ts`](https://github.com/spore-host/truffle-ts); it consumes a
truffle-ts finder for live checks, mirroring how Go `lagotto` polls via Go
`truffle`.

## Architecture

- **`src/core/`** — pure, DOM-free, provider-agnostic. `types.ts` (Watch /
  MatchResult), `matcher.ts` (`evaluate`, ported from Go `Evaluate`), `pattern.ts`
  (`wildcardToRegex`), `duration.ts`, `azs.ts`, `conditions.ts`. No dependency on
  truffle-ts or any AWS SDK. This is the `.` export.
- **`src/live/`** — `CapacityWatcher` (`check` + `poll`), the `./live` export.
  Consumes a truffle-ts finder through a structural `CapacityFinder` interface,
  so truffle-ts stays a **peer/optional** dependency (never imported directly).
- Ports track the Go source: keep `evaluate` and `wildcardToRegex` behavior
  identical so a pattern/match behaves the same in the CLI and here.

## Scope

v0.1.0 is **Foundation**: pure matcher + live check-now/poll-while-open. NOT yet
ported: action modes (notify/hold/spawn), persistent/hosted polling, goal-driven
fleet supervision — server/daemon concerns. Don't invent a persistence or hosted
poller here without a decision; those belong to the backend, not this library.

## Versioning & changelog (required)

Semantic Versioning + Keep a Changelog. Every user-facing change updates
`CHANGELOG.md` under `## [Unreleased]` in the same PR. Pre-1.0, breaking changes
bump MINOR. Release: rename `[Unreleased]` → `[X.Y.Z] - DATE`, tag `vX.Y.Z` →
`publish.yml` publishes to npm via Trusted Publishing (OIDC, no token).

## Build & test

- `npm run typecheck` — `tsc --noEmit`
- `npm test` / `npm run test:cov` — vitest
- `npm run build:lib` — emit `dist/` (the published artifact; `.` + `./live`
  declarations must both exist)
- `npm run build` — library + TypeDoc

## Publishing

Package `@spore-host/lagotto-ts`. First publish must be manual (Trusted
Publishing can't bootstrap a never-published package); after the trusted
publisher is registered on npmjs.com (org spore-host, repo lagotto-ts, workflow
publish.yml), tag `v*` → token-free OIDC publish with provenance.
