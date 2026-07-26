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
//   const aws = new AwsLiveFinder({ regions: ["us-east-1"], pricing: "lazy" });
//   const watcher = new CapacityWatcher({ finder: truffleFinderAdapter(aws, "us-east-1") });
//   const match = await watcher.check({ watchId: "w1", instanceTypePattern: "g5.*", regions: ["us-east-1"] });

export { CapacityWatcher } from "./watcher.js";
export type {
  CapacityFinder,
  CapacityWatcherOptions,
  CheckResult,
  FinderInstanceType,
  FinderSpotPrice,
} from "./watcher.js";

export { truffleFinderAdapter } from "./truffle-adapter.js";
export type {
  TruffleLiveFinder,
  TruffleInstanceType,
  TruffleSpotPriceResult,
} from "./truffle-adapter.js";
