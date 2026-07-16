import { createClient, SupabaseClient } from "@supabase/supabase-js";

/* Browser client — read-only via RLS + Realtime subscriptions.
   Safe to import in client components. */
let browserClient: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null; // env not configured → dashboard stays in sim mode
  if (!browserClient) browserClient = createClient(url, key);
  return browserClient;
}

/* Server client — full access, bypasses RLS.
   ONLY import inside app/api/** route handlers. */
export function supabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
