'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/chat', label: 'New claim' },
  { href: '/claims', label: 'My claims' },
  { href: '/finance', label: 'Finance review' },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="nav">
      {ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={path === i.href || (i.href !== '/' && path.startsWith(i.href + '/')) ? 'page' : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
