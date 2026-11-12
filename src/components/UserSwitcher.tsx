'use client';

import { useTransition } from 'react';
import { switchUser } from '@/app/actions';

interface Person {
  id: string;
  name: string;
  grade: string;
  role: string;
}

/** Demo only: lets you view the app as a finance user. Not real authentication. */
export function UserSwitcher({ currentId, people }: { currentId: string; people: Person[] }) {
  const [pending, start] = useTransition();
  return (
    <label className="user-switch">
      <span>Signed in as</span>
      <select
        value={currentId}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          start(async () => {
            await switchUser(id);
          });
        }}
      >
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.id}, {p.grade}
            {p.role === 'finance' ? ', finance' : ''})
          </option>
        ))}
      </select>
    </label>
  );
}
