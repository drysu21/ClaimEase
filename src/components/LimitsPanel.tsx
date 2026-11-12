import { CATEGORIES, MAX_CLAIM_AGE_DAYS, inr } from '@/lib/domain';
import type { PolicyRule } from '@/lib/claims';

type Rule = PolicyRule & { category: string };

function limitText(rules: Rule[]): { text: string; sub?: string } {
  if (rules.length === 0) return { text: 'No rule' };
  const metro = rules.find((r) => r.city_tier === 'metro');
  const other = rules.find((r) => r.city_tier === 'other');
  if (metro && other) return { text: `${inr(metro.max_amount)} per night`, sub: `${inr(other.max_amount)} outside metro cities` };
  const r = rules[0];
  return { text: `${inr(r.max_amount)} ${r.unit === 'per_night' ? 'per night' : 'per claim'}` };
}

export function LimitsPanel({ grade, rules }: { grade: string; rules: Rule[] }) {
  return (
    <aside className="limits" aria-labelledby="limits-title">
      <h2 id="limits-title">Your {grade} limits</h2>
      <table>
        <caption className="visually-hidden">Maximum amount per category for grade {grade}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col" className="num">Maximum</th>
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => {
            const l = limitText(rules.filter((r) => r.category === c.key));
            return (
              <tr key={c.key}>
                <th scope="row">{c.label}</th>
                <td className="num">
                  {l.text}
                  {l.sub && <span className="sub">{l.sub}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        Claims older than {MAX_CLAIM_AGE_DAYS} days are not accepted. A claim over its limit is still saved, flagged with the reason, for finance to review.
      </p>
    </aside>
  );
}
