import { getFirestore } from 'firebase-admin/firestore';
import { itemKey, isCountableOrder } from '../util';
import { escapeMd } from '../telegram_api';

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
  const snapshot = await db.collection('orders')
    .where('dateLabel', '==', dateLabel)
    .get();

  if (snapshot.empty) return null;

  let totalSales = 0;
  let kioskSales = 0;
  let staffSales = 0;
  let totalOrders = 0;
  const itemCounts: { [key: string]: number } = {};

  snapshot.forEach(doc => {
    const data = doc.data();
    if (!isCountableOrder(data)) return;
    totalOrders += 1;
    const amount = data.totalAmount || 0;
    totalSales += amount;

    if (data.entryType === 'Staff') staffSales += amount;
    else kioskSales += amount;

    for (const item of data.items || []) {
      const key = itemKey(item.name, item.variant);
      itemCounts[key] = (itemCounts[key] || 0) + (item.quantity || 1);
    }
  });

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
