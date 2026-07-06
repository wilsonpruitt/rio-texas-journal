import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Generic Supabase admin client — conference-agnostic, used by every build/import/
// reconcile script. Moved out of parsers/era_b/lib/db.ts (which re-exports it) since
// era_b is a per-conference journal-PDF parser, not the engine.
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
