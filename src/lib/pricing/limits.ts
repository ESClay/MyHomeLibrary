/** On-demand price checks allowed per person in any rolling 24 hours. Each check costs eBay one or two search calls. */
export const PRICE_CHECK_DAILY_CAP = 30;

export function checksLeft(usedToday: number, cap = PRICE_CHECK_DAILY_CAP): number {
  return Math.max(0, cap - usedToday);
}
