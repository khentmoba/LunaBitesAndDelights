import { getFirestore } from 'firebase-admin/firestore';
import { itemKey, isCountableOrder, finiteNumber } from '../util';
import { escapeMd } from '../telegram_api';
import { dayFromDoc, isDailyStatsBackfilled, scanOrdersForDate } from './daily_stats';

export interface DailySales {
  date: string;
  totalSales: number;
  kioskSales: number;
  staffSales: number;
  totalOrders: number;
  topItems: { name: string; qty: number }[];
}

export async function aggregateDailySales(dateLabel: string): Promise<DailySales | null> {
  const db = getFirestore();

  const [backfilled, daySnap] = await Promise.all([
    isDailyStatsBackfilled(db),
    db.collection('dailyStats').doc(dateLabel).get(),
  ]);
  if (backfilled) {
    if (!daySnap.exists) return null;
    const day = dayFromDoc(dateLabel, daySnap.data()!);
    if (day.orders <= 0) return null;
    const topItems = Object.values(day.items)
      .filter((it) => it.qty > 0)
      .map((it) => ({ name: itemKey(it.name || 'Unknown', it.variant), qty: it.qty }))
      .sort((a, b) => b.qty - a.qty);
    return {
      date: dateLabel,
      totalSales: day.revenue,
      kioskSales: day.entryType.kiosk.revenue,
      staffSales: day.entryType.staff.revenue,
      totalOrders: day.orders,
      topItems,
    };
  }

  const snapshot = await scanOrdersForDate(db, dateLabel);

  if (snapshot.length === 0) return null;

  let totalSales = 0;
  let kioskSales = 0;
  let staffSales = 0;
  let totalOrders = 0;
  const itemCounts: { [key: string]: number } = Object.create(null);

  for (const doc of snapshot) {
    const data = doc.data();
    if (!isCountableOrder(data)) continue;
    totalOrders += 1;
    const amount = finiteNumber(data.totalAmount);
    totalSales += amount;

    if (data.entryType === 'Staff') staffSales += amount;
    else kioskSales += amount;

    const rawItems = Array.isArray(data.items) ? data.items : [];
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      const key = itemKey(typeof item.name === 'string' && item.name ? item.name : 'Unknown', typeof item.variant === 'string' ? item.variant : undefined);
      const rawQty = finiteNumber(item.quantity || item.qty);
      itemCounts[key] = (itemCounts[key] || 0) + (rawQty > 0 ? rawQty : 1);
    }
  }

  if (totalOrders === 0) return null;

  return {
    date: dateLabel,
    totalSales,
    kioskSales,
    staffSales,
    totalOrders,
    topItems: Object.entries(itemCounts)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
  };
}

/** Shared Telegram body for the daily and manual sales reports. */
export function salesReportMessage(
  report: DailySales,
  opts: { title: string; subtitle?: string; footer?: string }
): string {
  const itemsList = report.topItems
    .slice(0, 10)
    .map(i => `  • ${escapeMd(i.name)}: *${i.qty}*`)
    .join('\n');

  return [
    `📊 *${opts.title} — ${escapeMd(report.date)}*`,
    ...(opts.subtitle ? [opts.subtitle] : []),
    '',
    `💰 *Total Sales:* ₱*${escapeMd(report.totalSales.toString())}*`,
    `🛒 *Total Orders:* ${report.totalOrders}`,
    '',
    `🏷 *Breakdown:*`,
    `  • Kiosk Orders: ₱${escapeMd(report.kioskSales.toString())}`,
    `  • Walk\\-in/Staff: ₱${escapeMd(report.staffSales.toString())}`,
    '',
    `🔥 *Top Items:*`,
    itemsList,
    ...(opts.footer ? ['', opts.footer] : []),
  ].join('\n');
}
