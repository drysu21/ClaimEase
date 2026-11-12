import { cookies } from 'next/headers';
import { getDb } from './store';
import { getEmployeeById, type Employee } from './claims';

// Demo sign-in. The brief says the logged-in user is Meera Nair (E001), so that is the default.
// The cookie only exists so the finance screens can be demoed as a finance user. It is NOT secure
// authentication: anyone can set it. Replace this one file with a real session before going live.
export const USER_COOKIE = 'claimease_user';
export const DEFAULT_USER_ID = 'E001';

export async function currentEmployee(): Promise<Employee> {
  const jar = await cookies();
  const db = getDb();
  const wanted = jar.get(USER_COOKIE)?.value;
  return (wanted && getEmployeeById(db, wanted)) || (getEmployeeById(db, DEFAULT_USER_ID) as Employee);
}
