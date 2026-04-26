import type { Calendar, Event } from "../types.js";
import type { SoccerStage } from "./stages.js";

// Calendar-level discriminator for the renderer's per-format dispatch.
// "league"     — pure-league competitions (Premier League, Süper Lig).
// "cup_groups" — group-stage cups (World Cup, Euro before 2024).
// "cup_swiss"  — Swiss-system cups (UCL 2024-25+).
//
// Soccer-specific for now. Other categories may introduce their own
// type slots later (e.g. F1 might add "championship_with_sprint" vs
// "championship_traditional").
export type SoccerCalendarType = "league" | "cup_groups" | "cup_swiss";

export const SOCCER_CALENDAR_TYPES: readonly SoccerCalendarType[] = [
  "league",
  "cup_groups",
  "cup_swiss",
];

export function isSoccerCalendarType(
  value: unknown,
): value is SoccerCalendarType {
  return (
    typeof value === "string" &&
    (SOCCER_CALENDAR_TYPES as readonly string[]).includes(value)
  );
}

// Stable foreign key into Calendar.teams[]. Display strings (home/away)
// can drift between upstream batches; team ids don't.
//
// id format: lowercase alphanumerics + internal hyphens, no leading or
// trailing hyphen. Examples: "barcelona", "man-city", "sao-paulo", "1".
//
// Reserved for Phase 2: a `logo` field. Don't add it now.
export interface Team {
  id: string;
  name: string;
}

export const TEAM_ID_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Soccer typed_block. `home`/`away` accept null for pre-draw fixtures
// where one or both teams are TBD (Q5-a). `leg` is populated by
// deriveLegs() for KO ties; `group` is set for group-stage matches.
//
// `matchday` semantics differ by calendar type:
//   - cup_groups: matchday within a group (1, 2, 3).
//   - league / cup_swiss: season-wide matchweek/round number.
//
// `home_id` and `away_id` are foreign keys into Calendar.teams[].
// Optional because pre-draw fixtures may have unresolved teams.
export interface SoccerTypedBlock {
  home: string | null;
  away: string | null;
  stage: SoccerStage;
  group?: string;
  leg?: 1 | 2;
  match_number?: number;
  matchday?: number;
  home_id?: string;
  away_id?: string;
}

export interface SoccerEvent extends Event {
  soccer: SoccerTypedBlock;
}

export interface SoccerCalendar extends Calendar<SoccerEvent> {
  category: "soccer";
  // Optional competition-format discriminator. When unset, the renderer
  // falls back to a default soccer layout. When set, the renderer
  // dispatches to a format-specific layout.
  type?: SoccerCalendarType;
  // Optional team registry. Populated for calendars that provide
  // home_id/away_id on events; absent for legacy calendars that
  // only carry display strings.
  teams?: Team[];
}

export type { SoccerStage } from "./stages.js";
export {
  stageOrder,
  koLegStages,
  normalizeStage,
  isSoccerStage,
  stageRank,
} from "./stages.js";
export type { SoccerResult } from "./result.js";
export { validateSoccerResult } from "./result.js";
