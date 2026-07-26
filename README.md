# lagotto-ts

Browser-native EC2 **capacity watching** — match instance-type patterns against
live availability and report when capacity appears. A TypeScript port of the
spore.host [`lagotto`](https://github.com/spore-host/lagotto) tool.

Some instance types — particularly high-demand GPU families — aren't always
available. `lagotto-ts` lets you describe the capacity you want (a glob like
`p5.*`, optionally Spot and price-capped, optionally pinned to AZs) and check
for it, or poll while a tab or script is open, reporting the cheapest match the
moment it appears.

Part of the spore.host suite alongside
[`spawn-ts`](https://github.com/spore-host/spawn-ts) (launch + self-terminate)
and [`truffle-ts`](https://github.com/spore-host/truffle-ts) (instance
discovery). lagotto-ts's live capacity check is driven by a truffle-ts finder,
exactly as the Go `lagotto` polls via Go `truffle`.

## Install

```bash
npm install @spore-host/lagotto-ts
# for the live capacity check, also install the peer + its live finder:
npm install @spore-host/truffle-ts
```

## Two entry points

- **`@spore-host/lagotto-ts`** — the pure, offline core: the matcher, glob→regex
  pattern conversion, duration parsing, AZ preference handling, and `--until`
  completion conditions. No AWS SDK, no truffle-ts — safe in any bundle.
- **`@spore-host/lagotto-ts/live`** — the `CapacityWatcher`, which consumes a
  truffle-ts finder to hit real EC2. Node/CLI/server only.

## Quick start

### Match logic (offline, pure)

```ts
import { evaluate, wildcardToRegex } from "@spore-host/lagotto-ts";

wildcardToRegex("g5.*"); // "^g5\\..*$"

const match = evaluate(
  { watchId: "w1", instanceTypePattern: "g5.*", regions: ["us-east-1"], maxPrice: 2 },
  { instanceType: { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1.006, availableAZs: ["us-east-1a"] } },
);
// → { watchId: "w1", instanceType: "g5.xlarge", price: 1.006, availabilityZone: "us-east-1a", ... }
```

### Live capacity check (Node)

```ts
import { AwsLiveFinder } from "@spore-host/truffle-ts/live";
import { CapacityWatcher } from "@spore-host/lagotto-ts/live";

const finder = new AwsLiveFinder({ regions: ["us-east-1"], pricing: "lazy" });
const watcher = new CapacityWatcher({ finder });

// Check once…
const match = await watcher.check({
  watchId: "w1",
  instanceTypePattern: "g5.*",
  regions: ["us-east-1"],
});

// …or poll until capacity appears (or the signal aborts / maxChecks is hit).
const first = await watcher.poll(
  { watchId: "w1", instanceTypePattern: "p5.*", regions: ["us-east-1"] },
  { intervalMs: 60_000, onCheck: (r, n) => console.log(`check ${n}:`, r ? "found!" : "waiting…") },
);
```

## Scope of this release (v0.1.0 — Foundation)

- ✅ Pure matcher (`evaluate`), glob/regex patterns, duration parsing, AZ
  preference, `http-200` + `s3-empty` completion conditions.
- ✅ Live `CapacityWatcher` (`check` + `poll`) over a truffle-ts finder.
- ⏳ Not yet: action modes (notify/hold/spawn), persistent/hosted polling, and
  goal-driven fleet supervision — these are daemon/server concerns tracked for
  later milestones. The Go [`lagotto`](https://github.com/spore-host/lagotto) has
  the full set today.

## License

Apache-2.0 © Scott Friedman. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
