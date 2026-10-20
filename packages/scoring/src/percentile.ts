/**
 * Percentile within a benchmark's model set.
 *
 * Ties sit at their average position. A single observation returns 50 because
 * there is no spread to rank against.
 */
export function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 50;

  let lower = 0;
  let equal = 0;
  for (const candidate of all) {
    if (candidate < value) lower += 1;
    else if (candidate === value) equal += 1;
  }

  const percentile =
    ((lower + (equal - 1) / 2) / (all.length - 1)) * 100;

  return Math.min(100, Math.max(0, percentile));
}
