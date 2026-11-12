import Link from 'next/link';
import { currentEmployee } from '@/lib/auth';
import { getDb } from '@/lib/store';
import { listEmployees } from '@/lib/claims';
import { NavLinks } from './NavLinks';
import { UserSwitcher } from './UserSwitcher';

export async function Header() {
  const me = await currentEmployee();
  const people = (await listEmployees(getDb())).map(({ id, name, grade, role }) => ({ id, name, grade, role }));
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/chat" className="brand">
          ClaimEase
        </Link>
        <NavLinks />
        <UserSwitcher currentId={me.id} people={people} />
      </div>
    </header>
  );
}
