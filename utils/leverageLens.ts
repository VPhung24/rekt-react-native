export type Side = 'long' | 'short';

/**
 * Compute viewport range for a leverage lens around an anchor price.
 * Keeps the price chart as-is but scales the vertical span proportional to 1/leverage.
 */
export function viewportFor({
  anchor,
  leverage,
  pnlSpan = 1.2,
  minBandBps = 4,
}: {
  anchor: number;
  leverage: number;
  pnlSpan?: number;
  minBandBps?: number;
}) {
  const halfSpanByL = anchor * (pnlSpan / Math.max(1, leverage));
  const floor = anchor * (minBandBps / 1e4);
  const half = Math.max(halfSpanByL, floor);
  return { yMin: anchor - half, yMax: anchor + half };
}

/**
 * Isolated liquidation approximation.
 * Ignores fees/funding and tiered MMR. Gate L upstream so 1/L >= mmr.
 */
export function isolatedLiq({
  entry,
  leverage,
  side,
  mmr,
}: {
  entry: number;
  leverage: number;
  side: Side;
  mmr: number;
}) {
  const L = Math.max(1, leverage);
  if (side === 'long') {
    return (entry * (1 - 1 / L)) / (1 - mmr);
  }
  return (entry * (1 + 1 / L)) / (1 + mmr);
}

/**
 * Generate PnL grid helper ticks.
 * Returns price levels corresponding to PnL% relative to equity via leverage mapping.
 */
export function pnlTicks({
  anchor,
  leverage,
  span = 1.0,
}: {
  anchor: number;
  leverage: number;
  span?: number; // span=1 => ±100% lines
}) {
  const levels = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1].map((v) => v * span);
  const L = Math.max(1, leverage);
  return levels.map((pnl) => ({
    pnlPct: pnl * 100,
    price: anchor * (1 + pnl / L),
  }));
}

/**
 * Fixed decimals per asset for y-axis ticks.
 */
export const yDecimals = (sym: 'BTC' | 'ETH' | 'SOL') => (sym === 'BTC' ? 1 : 3);


