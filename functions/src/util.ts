/** Philippines is UTC+8. Returns 'YYYY-MM-DD'. */
export function phtDateLabel(d = new Date()): string {
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const m = String(pht.getUTCMonth() + 1).padStart(2, "0");
  const day = String(pht.getUTCDate()).padStart(2, "0");
  return `${pht.getUTCFullYear()}-${m}-${day}`;
}

/** Composite item key including variant: 'Name (Variant)' or 'Name'. */
export function itemKey(name: string, variant?: string): string {
  return variant ? `${name} (${variant})` : name;
}

export interface ChannelBucket {
  revenue: number;
  count: number;
}

export interface ChannelBreakdown {
  walkIn: ChannelBucket;
  delivery: ChannelBucket;
  pickup: ChannelBucket;
}

export function emptyChannel(): ChannelBreakdown {
  const zero = () => ({ revenue: 0, count: 0 });
  return { walkIn: zero(), delivery: zero(), pickup: zero() };
}

/** Adds an order total to the matching channel bucket (Pickup default). */
export function addToChannel(
  b: ChannelBreakdown,
  orderType: string,
  amount: number
): void {
  const bucket =
    orderType === "Walk-In" ? b.walkIn :
    orderType === "Delivery" ? b.delivery : b.pickup;
  bucket.revenue += amount;
  bucket.count += 1;
}

/**
 * Returns false for cancelled orders and unpaid/failed GCash orders so
 * sales reports and analytics only count real revenue.
 */
export function isCountableOrder(data: Record<string, any> | undefined): boolean {
  if (!data) return false;
  if (data.status === "Cancelled") return false;
  const method = String(data.paymentMethod || "").toLowerCase();
  const paymentStatus = String(data.paymentStatus || "");
  if (method === "gcash" && (paymentStatus === "AWAITING_PAYMENT" || paymentStatus === "PAYMENT_FAILED")) {
    return false;
  }
  return true;
}
