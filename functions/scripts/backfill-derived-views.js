// One-time backfill for the views the onOrderWritten trigger maintains.
// Run once after the trigger is deployed, ideally outside opening hours:
//
//   cd functions && npm run build
//   node scripts/backfill-derived-views.js           # dry run: reads, prints, writes nothing
//   node scripts/backfill-derived-views.js --apply   # writes dailyStats, kds_orders, stats_meta
//
// Auth: GOOGLE_APPLICATION_CREDENTIALS (service account) or gcloud ADC.
// Reads every order once. Rewrites each dailyStats day from scratch, mirrors
// the last 7 days of orders into kds_orders, then marks stats_meta/dailyStats
// so getLifetimeSalesReport switches from scanning orders to reading dailyStats.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { daysFromOrders } = require('../lib/reporting/daily_stats');
const { kdsMirrorDoc } = require('../lib/orders/derived');

const KDS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

async function backfill(db, { apply = false, log = console.log } = {}) {
  const orders = await db.collection('orders').get();
  const days = daysFromOrders(orders.docs.map((d) => d.data()));
  const existing = await db.collection('dailyStats').get();
  const stale = existing.docs.filter((d) => !days.has(d.id));
  const cutoff = Date.now() - KDS_LOOKBACK_MS;
  const recent = orders.docs.filter((d) => {
    const ts = d.get('timestamp');
    return ts instanceof Timestamp && ts.toMillis() >= cutoff;
  });

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    ordersRead: orders.size,
    dailyStatsDays: days.size,
    staleDailyStatsDeleted: stale.length,
    kdsMirrorDocs: recent.length,
    revenue: [...days.values()].reduce((s, d) => s + d.revenue, 0),
    countableOrders: [...days.values()].reduce((s, d) => s + d.orders, 0),
  };
  log(JSON.stringify(summary, null, 2));
  if (!apply) return summary;

  const writer = db.bulkWriter();
  for (const [date, day] of days) writer.set(db.collection('dailyStats').doc(date), { ...day, updatedAt: Timestamp.now() });
  for (const d of stale) writer.delete(d.ref);
  for (const d of recent) writer.set(db.collection('kds_orders').doc(d.id), kdsMirrorDoc(d.id, d.data()));
  await writer.close();
  await db.doc('stats_meta/dailyStats').set({ backfilledAt: Timestamp.now(), ordersRead: orders.size });
  log('Backfill written; getLifetimeSalesReport now reads dailyStats.');
  return summary;
}

module.exports = { backfill };

if (require.main === module) {
  if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'lunaexpress' });
  backfill(getFirestore(), { apply: process.argv.includes('--apply') })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
