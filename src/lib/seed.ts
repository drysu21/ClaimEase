import type { Db } from './db';
import { createClaim, decideClaim, getEmployeeById } from './claims';
import { todayISO, addDays, type Grade } from './domain';

// Demo data. Edit freely: policy_rules is the single source of truth for limits.

const EMPLOYEES = [
  ['E001', 'Meera Nair', 'meera.nair@example.com', 'L2', 'Sales', 'employee'],
  ['E002', 'Rohan Verma', 'rohan.verma@example.com', 'L1', 'Engineering', 'employee'],
  ['E003', 'Ananya Iyer', 'ananya.iyer@example.com', 'L3', 'Marketing', 'employee'],
  ['E004', 'Karthik Menon', 'karthik.menon@example.com', 'L4', 'Operations', 'employee'],
  ['E900', 'Priya Sharma', 'priya.sharma@example.com', 'L3', 'Finance', 'finance'],
] as const;

type Row = { cat: string; tier: 'any' | 'metro' | 'other'; unit: 'per_claim' | 'per_night'; max: [number, number, number, number]; notes?: string };

// Maximum in rupees for grades L1, L2, L3, L4.
const LIMITS: Row[] = [
  { cat: 'meals', tier: 'any', unit: 'per_claim', max: [500, 700, 1000, 1500], notes: 'Solo meals only. Hosting a client is client entertainment.' },
  { cat: 'client_entertainment', tier: 'any', unit: 'per_claim', max: [1500, 3000, 5000, 8000], notes: 'Per event, whole table. Name the client in the description.' },
  { cat: 'local_travel', tier: 'any', unit: 'per_claim', max: [800, 1200, 2000, 3500] },
  { cat: 'airfare_rail', tier: 'any', unit: 'per_claim', max: [6000, 9000, 15000, 25000], notes: 'Economy fares.' },
  { cat: 'hotel', tier: 'metro', unit: 'per_night', max: [3500, 5000, 7500, 12000], notes: 'Metro cities: Mumbai, Delhi NCR, Bengaluru, Chennai, Kolkata, Hyderabad.' },
  { cat: 'hotel', tier: 'other', unit: 'per_night', max: [2500, 3500, 5000, 8000], notes: 'All other cities.' },
  { cat: 'office_supplies', tier: 'any', unit: 'per_claim', max: [1000, 2000, 3500, 5000] },
  { cat: 'internet_phone', tier: 'any', unit: 'per_claim', max: [500, 800, 1200, 1500], notes: 'Monthly bill, work share only.' },
  { cat: 'training', tier: 'any', unit: 'per_claim', max: [5000, 10000, 20000, 40000] },
];

interface SeedClaim {
  emp: string; cat: string; desc: string; amount: number; daysAgo: number; units?: number; city?: string;
  review?: { decision: 'approved' | 'rejected'; note?: string; daysAgo: number };
}

const CLAIMS: SeedClaim[] = [
  // Meera Nair (E001, L2): a spread of every status.
  { emp: 'E001', cat: 'training', desc: 'Online data analysis course', amount: 9500, daysAgo: 42, review: { decision: 'approved', daysAgo: 38 } },
  { emp: 'E001', cat: 'internet_phone', desc: 'Home broadband, October bill', amount: 1200, daysAgo: 31, review: { decision: 'rejected', note: 'Personal plan. Only the business share is reimbursable. Resubmit with a work-use split.', daysAgo: 28 } },
  { emp: 'E001', cat: 'airfare_rail', desc: 'Train to Delhi for the quarterly review', amount: 7800, daysAgo: 24, review: { decision: 'approved', daysAgo: 20 } },
  { emp: 'E001', cat: 'hotel', desc: 'Hotel for the Bengaluru partner offsite', amount: 12400, daysAgo: 12, units: 2, city: 'Bengaluru' },
  { emp: 'E001', cat: 'office_supplies', desc: 'Notebooks and whiteboard markers for the team', amount: 1850, daysAgo: 5 },
  { emp: 'E001', cat: 'local_travel', desc: 'Cab to the client office in Powai', amount: 640, daysAgo: 3 },
  // Other employees, so the finance queue has something in it.
  { emp: 'E004', cat: 'training', desc: 'Supply chain certification fee', amount: 35000, daysAgo: 11 },
  { emp: 'E003', cat: 'hotel', desc: 'Chennai trade show stay', amount: 20100, daysAgo: 9, units: 3, city: 'Chennai' },
  { emp: 'E003', cat: 'airfare_rail', desc: 'Flight to Kolkata for the product launch', amount: 18500, daysAgo: 7 },
  { emp: 'E002', cat: 'client_entertainment', desc: 'Lunch with the Acme Logistics team', amount: 1200, daysAgo: 6 },
  { emp: 'E004', cat: 'client_entertainment', desc: 'Dinner with Northwind leadership', amount: 9200, daysAgo: 5 },
  { emp: 'E002', cat: 'local_travel', desc: 'Auto and metro to the vendor site', amount: 420, daysAgo: 4 },
  { emp: 'E002', cat: 'meals', desc: 'Late-night dinner at the office during the release', amount: 950, daysAgo: 2 },
  { emp: 'E003', cat: 'office_supplies', desc: 'Printer cartridges', amount: 2900, daysAgo: 1 },
];

export function seedIfEmpty(db: Db, today: string = todayISO()): void {
  const n = db.prepare('SELECT COUNT(*) AS n FROM employees').get() as unknown as { n: number };
  if (n.n > 0) return;

  db.exec('BEGIN');
  try {
    const insEmp = db.prepare('INSERT INTO employees (id, name, email, grade, department, role) VALUES (?, ?, ?, ?, ?, ?)');
    for (const e of EMPLOYEES) insEmp.run(...e);

    const insRule = db.prepare('INSERT INTO policy_rules (category, grade, city_tier, max_amount, unit, notes) VALUES (?, ?, ?, ?, ?, ?)');
    const grades: Grade[] = ['L1', 'L2', 'L3', 'L4'];
    for (const r of LIMITS) grades.forEach((g, i) => insRule.run(r.cat, g, r.tier, r.max[i], r.unit, r.notes ?? null));

    const finance = getEmployeeById(db, 'E900')!;
    // Oldest first, so claim numbers rise with time.
    for (const c of [...CLAIMS].sort((a, b) => b.daysAgo - a.daysAgo)) {
      const emp = getEmployeeById(db, c.emp)!;
      const stamp = (daysAgo: number) => new Date(Date.now() - Math.max(daysAgo - 1, 0) * 86_400_000).toISOString();
      const res = createClaim(
        db, emp,
        { category: c.cat, amount: c.amount, units: c.units, city: c.city, expenseDate: addDays(today, -c.daysAgo), description: c.desc },
        { today, now: stamp(c.daysAgo) },
      );
      if (!res.ok) throw new Error(`Seed claim rejected: ${res.reasons.join(' ')}`);
      if (c.review) {
        const d = decideClaim(db, finance, res.claim.id, { decision: c.review.decision, note: c.review.note ?? 'Approved as submitted.' }, stamp(c.review.daysAgo));
        if (!d.ok) throw new Error(`Seed review failed: ${d.error}`);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
