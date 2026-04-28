import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Find or insert a church by canonical_name. Records the alias if the
 * raw form differs from the canonical form.
 */
export async function upsertChurch(
  db: SupabaseClient,
  rawName: string,
  canonicalName: string,
  cityHint: string | null,
  journalYear: number,
  sourceSection: string,
): Promise<string> {
  const { data: existing, error: selErr } = await db
    .from('church')
    .select('id')
    .eq('canonical_name', canonicalName)
    .maybeSingle();
  if (selErr) throw selErr;

  let churchId: string;
  if (existing) {
    churchId = existing.id;
  } else {
    const { data: inserted, error: insErr } = await db
      .from('church')
      .insert({ canonical_name: canonicalName, city: cityHint })
      .select('id')
      .single();
    if (insErr) throw insErr;
    churchId = inserted.id;
  }

  if (rawName !== canonicalName) {
    const { error: aliasErr } = await db
      .from('church_alias')
      .upsert(
        {
          church_id: churchId,
          alias: rawName,
          source_section: sourceSection,
          journal_year: journalYear,
        },
        { onConflict: 'alias,journal_year,source_section', ignoreDuplicates: true },
      );
    if (aliasErr) throw aliasErr;
  }

  return churchId;
}
