// Per-conference config type. See ~/wroot-labs/notes/conference-atlas-architecture.md §2b.
// One conference = one deployed instance (one Vercel project + one Supabase project);
// this type is the single object every instance's config.ts must satisfy.

export type ConferenceConfig = {
  schemaVersion: 1;
  slug: string;
  name: string;
  shortName: string;
  jurisdiction?: string;

  years: {
    gcfaMin: number;
    dataMin: number;
    dataMax: number;
    trainMin: number;
    trainMax: number;
    openEnd: number;
  };

  districts: {
    current: string[];
    assignment: Array<"roster" | "county">;
  };

  ingest: {
    adapters: Array<"gcfa-extract" | "ezra-export" | "spreadsheet" | "journal-pdf">;
    gcfaExtract?: { workbook: string };
    journalPdf?: { eras: Array<{ id: string; years: [number, number]; parser: string }> };
  };

  models: {
    par?: Partial<{
      gateMembers: number;
      kShrink: number;
      trail: number;
      strengthChurch: number;
      strengthCohort: number;
    }>;
    viability?: Partial<{
      sustainableShare: number;
      burdenStrained: number;
      burdenUnsustainable: number;
      floorMembers: number;
      floorPercentile: number;
    }>;
  };

  modules: Record<
    | "journalArchive"
    | "atlas"
    | "vitality"
    | "conferenceFinance"
    | "signals"
    | "careers"
    | "map"
    | "planting",
    boolean
  >;

  branding: {
    siteTitle: string;
    ogTagline?: string;
    footerNote?: string;
    metaDescription?: string;
  };

  access: {
    staff: { mode: "unlock-code" | "supabase-auth" };
  };
};
