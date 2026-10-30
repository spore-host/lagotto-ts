// Public entry for the LIVE capacity watcher — imported as
// "@spore-host/lagotto-ts/live". It consumes a truffle-ts finder (typically the
// Node-only AwsLiveFinder from "@spore-host/truffle-ts/live") to check real EC2
// availability, so it belongs in CLI/server/Node code, not a browser bundle.
// The finder is taken as a structural CapacityFinder, so truffle-ts stays a
// peer/optional dependency — lagotto-ts never imports it directly.
//
//   import { AwsLiveFinder } from "@spore-host/truffle-ts/live";
//   import { CapacityWatcher } from "@spore-host/lagotto-ts/live";
//
//   // One truffle finder per region; lagotto-ts fans out across them itself.
//   // `includeAZs` (truffle-ts >= 0.6) lets an on-demand watch pin AZs.
//   const watcher = new CapacityWatcher({
//     finderFor: truffleFinderFor((r) => new AwsLiveFinder({ regions: r, pricing: "lazy", includeAZs: true })),
//   });
//   const match = await watcher.check({
//     watchId: "w1", instanceTypePattern: "p5.*", regions: ["us-east-1", "us-west-2"],
//   });

export { CapacityWatcher } from "./watcher.js";
export type {
  CapacityFinder,
  CapacityWatcherOptions,
  CheckResult,
  CheckWarning,
  FinderInstanceType,
  FinderSpotPrice,
} from "./watcher.js";

export { truffleFinderAdapter, truffleFinderFor } from "./truffle-adapter.js";
export type {
  TruffleLiveFinder,
  TruffleInstanceType,
  TruffleSpotPriceResult,
} from "./truffle-adapter.js";
