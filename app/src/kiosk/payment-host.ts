// The hosts a PayMongo checkout may live on (SECURITY.md #15).
const ALLOWED = ['paymongo.com', 'gcash.com', 'paymaya.com', 'maya.ph'];

/** True for an https URL on an allowed payment host or one of its subdomains. */
export function isPaymentUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED.some((a) => host === a || host.endsWith(`.${a}`));
}

/** Validates a `createCheckoutSession` response before entering the ready state. */
export function parseCheckoutSessionResponse(
  data: { checkoutUrl?: unknown; checkoutSessionId?: unknown } | null | undefined,
): { checkoutUrl: string; sessionId: string } {
  const checkoutUrl = typeof data?.checkoutUrl === 'string' ? data.checkoutUrl.trim() : '';
  if (!isPaymentUrl(checkoutUrl)) {
    throw new Error('The payment link is not a PayMongo page.');
  }
  const sessionId = typeof data?.checkoutSessionId === 'string' ? data.checkoutSessionId.trim() : '';
  if (!sessionId) {
    throw new Error('Payment session could not be initialized. Please retry.');
  }
  return { checkoutUrl, sessionId };
}
