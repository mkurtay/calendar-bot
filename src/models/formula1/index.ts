import type { Calendar, Event } from "../types.js";
import type { F1Session } from "./sessions.js";

// Formula 1 typed_block. `round` is required (renderer indexes by it
// for the "R5"-style chip); `is_sprint_weekend` flags weekends with
// the additional Sprint format sessions.
export interface F1TypedBlock {
  round: number;
  gp_name: string;
  circuit?: string;
  city?: string;
  country?: string;
  session: F1Session;
  is_sprint_weekend?: boolean;
}

export interface F1Event extends Event {
  formula1: F1TypedBlock;
}

export interface F1Calendar extends Calendar<F1Event> {
  category: "formula1";
}

export type { F1Session } from "./sessions.js";
export { sessionOrder, isF1Session } from "./sessions.js";
