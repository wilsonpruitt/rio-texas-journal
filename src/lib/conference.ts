import type { ConferenceConfig } from "./conference-config";
import rioTexas from "../../conferences/rio-texas/config";

// Single instance-selection point. One Vercel project = one CONFERENCE_SLUG = one
// config. Every current import of district-2025.ts / branding strings / model
// constants should eventually resolve through this module instead of a hardcoded
// literal (see extraction plan, ~/wroot-labs/notes/conference-atlas-architecture.md).
const CONFERENCES: Record<string, ConferenceConfig> = {
  "rio-texas": rioTexas,
};

const slug = process.env.CONFERENCE_SLUG ?? "rio-texas";

const config = CONFERENCES[slug];
if (!config) {
  throw new Error(`Unknown CONFERENCE_SLUG "${slug}" — no conferences/${slug}/config.ts`);
}

export default config;
export type { ConferenceConfig };
