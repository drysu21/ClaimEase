import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Db = SupabaseClient;

/** Server-only Supabase client. Uses the secret key, so never import this from a client component. */
export function openDb(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY): Db {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example).');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Unwraps a Supabase response: throws on error so callers never read half a result. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
