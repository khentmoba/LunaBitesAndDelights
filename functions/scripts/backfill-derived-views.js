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
const { getFirestore, Timestamp, FieldPath } = require('firebase-admin/firestore');
const { contributionOf, emptyDay, applyToDay } = require('../lib/reporting/daily_stats');
const { isOrderVisibleInKds } = require('../lib/orders/kds');
const { kdsMirrorDoc, KDS_MIRROR_TTL_MS } = require('../lib/orders/derived');

const KDS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const ORDERS_PAGE_SIZE = 1000;

async function backfill(db, { apply = false, log = console.log } = {}) {
  const days = new Map();
  const recent = [];
  const cutoff = Date.now() - KDS_LOOKBACK_MS;
  let ordersRead = 0;
  let lastDoc = null;

  for (;;) {
    let query = db.collection('orders').orderBy(FieldPath.documentId()).limit(ORDERS_PAGE_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);
    const page = await query.get();
    if (page.empty) break;

    for (const d of page.docs) {
      ordersRead += 1;
      const data = d.data();
      const c = contributionOf(data);
      if (c) {
        let day = days.get(c.date);
        if (!day) days.set(c.date, (day = emptyDay(c.date)));
        applyToDay(day, c, 1);
      }
      const ts = d.get('timestamp');
      if (ts instanceof Timestamp && ts.toMillis() >= cutoff && isOrderVisibleInKds(data)) {
        recent.push({ id: d.id, data, tsMs: ts.toMillis() });
      }
    }

    lastDoc = page.docs[page.docs.length - 1];
    if (page.size < ORDERS_PAGE_SIZE) break;
  }

  const existing = await db.collection('dailyStats').get();
  const stale = existing.docs.filter((d) => !days.has(d.id));

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    ordersRead,
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
  for (const { id, data, tsMs } of recent) {
    writer.set(db.collection('kds_orders').doc(id), {
      ...kdsMirrorDoc(id, data),
      sourceEventMs: tsMs,
      expireAt: Timestamp.fromMillis(tsMs + KDS_MIRROR_TTL_MS),
    });
  }
  await writer.close();
  await db.doc('stats_meta/dailyStats').set({ backfilledAt: Timestamp.now(), ordersRead });
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
