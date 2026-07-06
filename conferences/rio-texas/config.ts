import type { ConferenceConfig } from "../../src/lib/conference-config.ts";

// Rio Texas Annual Conference — reference instance. Values captured here are the
// literals that lived scattered across scripts/build-*.ts, src/lib/district-2025.ts,
// and app branding strings before extraction (see
// ~/wroot-labs/notes/conference-atlas-architecture.md, step 0).

const config: ConferenceConfig = {
  schemaVersion: 1,
  slug: "rio-texas",
  name: "Rio Texas Annual Conference",
  shortName: "Rio Texas",
  jurisdiction: "South Central Jurisdiction",

  years: {
    gcfaMin: 2000,
    dataMin: 2015, // reliable appointment coverage starts 2015 (Rio Texas merger)
    dataMax: 2024, // include 2024 where the church reported
    trainMin: 2005,
    trainMax: 2023,
    openEnd: 2026, // open-ended stints run through journal_year 2025
  },

  districts: {
    current: ["Central", "North", "South"],
    assignment: ["roster", "county"],
  },

  ingest: {
    adapters: ["gcfa-extract", "journal-pdf"],
    gcfaExtract: {
      workbook: "~/Downloads/Service Ticket #726954 - Wilson Pruitt.xlsx",
    },
    journalPdf: {
      eras: [
        { id: "era_a", years: [2015, 2022], parser: "era_a" },
        { id: "era_b", years: [2023, 2025], parser: "era_b" },
      ],
    },
  },

  models: {
    par: {
      gateMembers: 25,
      kShrink: 2,
      trail: 3,
      strengthChurch: 5,
      strengthCohort: 50,
    },
    viability: {
      sustainableShare: 1 / 3, // share of operating income a charge can durably spend on pastoral support
      burdenStrained: 0.33,
      burdenUnsustainable: 0.45,
      floorMembers: 250, // "clearly full-time" cohort for deriving the floor
      floorPercentile: 0.25, // P25: a minimum viable full-time package
    },
  },

  modules: {
    journalArchive: false, // not yet built as a route (source PDFs live in journals/)
    atlas: true,
    vitality: true,
    conferenceFinance: true,
    signals: true,
    careers: true,
    map: true,
    planting: false,
  },

  branding: {
    siteTitle: "Rio Texas Atlas",
    ogTagline: "A Statistical Portrait of the Conference",
    footerNote: undefined,
  },

  access: {
    staff: { mode: "unlock-code" },
  },
};

export default config;
