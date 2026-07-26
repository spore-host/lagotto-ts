// Availability-zone preference handling — port of Go pkg/watcher/matcher.go
// azAllowed / orderAZs. A watch's `availabilityZones` both narrows (only these
// AZs are eligible) and prioritizes (in listed order); empty means every offered
// AZ, in the finder's order.

/**
 * Whether `az` passes the watch's AZ preference. An empty preference allows all;
 * an empty `az` (the source didn't report one) is always allowed.
 */
export function azAllowed(az: string, pref: string[] | undefined): boolean {
  if (az === "" || !pref || pref.length === 0) {
    return true;
  }
  return pref.includes(az);
}

/**
 * Filter + order the offered AZs by the watch's preference. With no preference,
 * the offered AZs are returned unchanged (all eligible). With a preference, only
 * offered AZs that appear in the preference are kept, in the preference's order —
 * so a caller can both pin (narrow) and prioritize zones.
 */
export function orderAZs(offered: string[], pref: string[] | undefined): string[] {
  if (!pref || pref.length === 0) {
    return offered;
  }
  const offeredSet = new Set(offered);
  return pref.filter((p) => offeredSet.has(p));
}
