'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { USER_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/store';
import { getEmployeeById } from '@/lib/claims';

/** Demo helper: switch who you are signed in as, so the finance screens can be shown. */
export async function switchUser(employeeId: string): Promise<void> {
  if (!getEmployeeById(getDb(), employeeId)) return;
  const jar = await cookies();
  jar.set(USER_COOKIE, employeeId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  revalidatePath('/', 'layout');
}
