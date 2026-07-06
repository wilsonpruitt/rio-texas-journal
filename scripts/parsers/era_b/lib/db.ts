import type { SupabaseClient } from '@supabase/supabase-js';

// Re-exported from the generic engine location; every existing script imports
// adminClient from here, so the re-export keeps them working unchanged.
export { adminClient } from "../../../lib/db.ts";

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
