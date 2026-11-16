// The pure parts of LifetimeAnalyticsPage (lib/screens/lifetime_analytics_page.dart):
// month axis labels, K/M number formatting and the date-range presets.

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** formatMonthAxisLabel: 'YYYY-MM' → "N '26". */
export function formatMonthAxisLabel(key: string): string {
  const parts = key.split('-');
  if (parts.length < 2) return key;
  const m = Number.parseInt(parts[1] ?? '', 10);
  if (!(m >= 1 && m <= 12)) return key;
  const y = parts[0] ?? '';
  return `${MONTHS[m - 1]} '${y.length >= 2 ? y.slice(-2) : y}`;
}

export const fmt = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
export const shortFmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export const PRESETS = [
  ['allTime', 'All Time'],
  ['today', 'Today'],
  ['thisWeek', 'This Week'],
  ['thisMonth', 'This Month'],
  ['thisYear', 'This Year'],
  ['custom', 'Custom'],
] as const;
export type Preset = (typeof PRESETS)[number][0];

/** Today's calendar date in the Philippines (UTC+8), as a UTC-midnight Date. */
export function phtToday(): Date {
  const p = new Date(Date.now() + 8 * 3600_000);
  return new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()));
}
export const label = (d: Date) => d.toISOString().slice(0, 10);

/** The startDate/endDate a preset sends, or null for all time. */
export function presetRange(preset: Preset, custom: { start: string; end: string } | null, today = phtToday()): { startDate: string; endDate: string } | null {
  const end = label(today);
  if (preset === 'custom' && custom) return { startDate: custom.start, endDate: custom.end };
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (preset) {
    case 'today':
      return { startDate: end, endDate: end };
    case 'thisWeek':
      return { startDate: label(new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400_000)), endDate: end };
    case 'thisMonth':
      return { startDate: label(new Date(Date.UTC(y, m, 1))), endDate: end };
    case 'thisYear':
      return { startDate: label(new Date(Date.UTC(y, 0, 1))), endDate: end };
    case 'custom':
      return { startDate: '2020-01-01', endDate: end };
    default:
      return null;
  }
}
