// The hosts a PayMongo checkout may live on. Flutter's GCash WebView allowed
// the same list (SECURITY.md #15).
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
