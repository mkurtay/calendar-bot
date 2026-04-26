import type { Calendar, Event } from "../types.js";
import type { SoccerStage } from "./stages.js";

// Soccer typed_block. `home`/`away` accept null for pre-draw fixtures
// where one or both teams are TBD (Q5-a). `leg` is populated by
// deriveLegs() for KO ties; `group` is set for group-stage matches.
export interface SoccerTypedBlock {
  home: string | null;
  away: string | null;
  stage: SoccerStage;
  group?: string;
  leg?: 1 | 2;
  match_number?: number;
}

export interface SoccerEvent extends Event {
  soccer: SoccerTypedBlock;
}

export interface SoccerCalendar extends Calendar<SoccerEvent> {
  category: "soccer";
}

export type { SoccerStage } from "./stages.js";
export {
  stageOrder,
  koLegStages,
  normalizeStage,
  isSoccerStage,
  stageRank,
} from "./stages.js";
