import type { Pricing, PricingTier } from "@omg/shared";

export interface TokenProfile {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Modeled list cost for one task profile.
 *
 * Cached tokens are capped at the input count. A tier (or the over-200K price
 * book) applies to the whole request, matching common vendor pricing.
 */
export function taskCost(pricing: Pricing, profile: TokenProfile): number | null {
  if (!pricing.pricingKnown) return null;

  const inputTokens = nonnegative(profile.inputTokens);
  const cachedInputTokens = Math.min(
    nonnegative(profile.cachedInputTokens),
    inputTokens,
  );
  const outputTokens = nonnegative(profile.outputTokens);

  let book: { input: number; output: number; cacheRead?: number } = pricing;

  if (inputTokens > 200_000 && pricing.contextOver200k) {
    book = pricing.contextOver200k;
  } else if (pricing.tiers && pricing.tiers.length > 0) {
    let selected: PricingTier | undefined;
    for (const tier of pricing.tiers) {
      if (
        tier.minInputTokens <= inputTokens &&
        (!selected || tier.minInputTokens > selected.minInputTokens)
      ) {
        selected = tier;
      }
    }
    if (selected) book = selected;
  }

  const cacheRead = book.cacheRead ?? book.input;
  const billableInput = inputTokens - cachedInputTokens;

  return (
    (billableInput * book.input +
      cachedInputTokens * cacheRead +
      outputTokens * book.output) /
    1_000_000
  );
}

/**
 * Effective task cost on a subscription at full utilization.
 *
 * `listCost * planUsd / includedUsageUsd` is the per-task share of the plan
 * when the included usage is fully consumed.
 */
export function goEffectiveCost(
  listCost: number | null,
  planUsd: number,
  includedUsageUsd: number,
): number | null {
  if (listCost === null || !Number.isFinite(listCost) || listCost < 0) {
    return null;
  }
  if (!Number.isFinite(planUsd) || planUsd <= 0) return null;
  if (!Number.isFinite(includedUsageUsd) || includedUsageUsd <= 0) return null;
  return (listCost * planUsd) / includedUsageUsd;
}

export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "price not published";
  if (value === 0) return "$0";
  if (value > 0 && value < 0.0001) return "<$0.0001";
  if (value < 1) return `$${value.toPrecision(2)}`;
  return `$${value.toFixed(2)}`;
}
