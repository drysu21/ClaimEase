// Shared constants and pure helpers. No I/O in here, so it is safe in client components too.

export const MAX_CLAIM_AGE_DAYS = 60;
export const GRADES = ['L1', 'L2', 'L3', 'L4'] as const;
export type Grade = (typeof GRADES)[number];
export const STATUSES = ['pending', 'flagged', 'approved', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];

export interface Category {
  key: string;
  label: string;
  hint: string;
}

export const CATEGORIES: Category[] = [
  { key: 'meals', label: 'Meals', hint: 'Solo meals while working late or travelling: breakfast, lunch, dinner, snacks, coffee.' },
  { key: 'client_entertainment', label: 'Client entertainment', hint: 'Dinners, lunches, drinks or events hosted for a client or external guest.' },
  { key: 'local_travel', label: 'Local travel', hint: 'Cabs, autos, metro, fuel, parking and tolls inside a city.' },
  { key: 'airfare_rail', label: 'Flights and trains', hint: 'Intercity flights, train tickets or long-distance bus tickets.' },
  { key: 'hotel', label: 'Hotel', hint: 'Accommodation while travelling for work. Needs the city and the number of nights.' },
  { key: 'office_supplies', label: 'Office supplies', hint: 'Stationery, printing and small work accessories.' },
  { key: 'internet_phone', label: 'Internet and phone', hint: 'Work-related broadband, mobile bills and data packs.' },
  { key: 'training', label: 'Training', hint: 'Courses, certifications, workshops and conference fees.' },
];
export const CATEGORY_BY_KEY: Record<string, Category> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

// Hotel limits depend on the city tier. Any city not listed counts as "other".
const METRO_CITIES = new Set([
  'mumbai', 'delhi', 'new delhi', 'bengaluru', 'bangalore', 'chennai', 'kolkata', 'hyderabad',
  'gurgaon', 'gurugram', 'noida',
]);
export const KNOWN_CITIES: string[] = [...METRO_CITIES];

export type CityTier = 'metro' | 'other';
export function cityTier(city: string | null | undefined): CityTier {
  return city && METRO_CITIES.has(city.trim().toLowerCase()) ? 'metro' : 'other';
}

// ---- dates: plain YYYY-MM-DD strings, compared as UTC midnights ----

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC milliseconds for a real calendar date string, otherwise null. */
export function parseISODate(s: unknown): number | null {
  const m = ISO_RE.exec(String(s ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

export function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today in the server's local calendar. */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(iso: string, n: number): string {
  return toISO((parseISODate(iso) as number) + n * 86_400_000);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round(((parseISODate(to) as number) - (parseISODate(from) as number)) / 86_400_000);
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function formatDate(iso: string | null | undefined): string {
  const ms = parseISODate(iso);
  return ms === null ? String(iso ?? '') : dateFmt.format(ms);
}

export function weekdayName(iso: string): string {
  return new Date(parseISODate(iso) as number).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

// ---- money and ids ----

export function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function claimRef(id: number): string {
  return 'CLM-' + String(id).padStart(4, '0');
}

export function plural(n: number, one: string, many: string = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
