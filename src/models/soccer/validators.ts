import { isISOUTC, type ValidationResult } from "../types.js";
import type { SoccerEvent, SoccerTypedBlock } from "./index.js";
import { isSoccerStage, stageOrder } from "./stages.js";

// Validates an unknown value claims to be a SoccerEvent. Used by the
// create_calendar / update_calendar tools to reject malformed input
// before it reaches GitHub commits.
export function validateSoccerEvent(event: unknown): ValidationResult {
  const errors: string[] = [];

  if (!event || typeof event !== "object") {
    return { ok: false, errors: ["event must be an object"] };
  }

  const e = event as Partial<SoccerEvent>;

  if (typeof e.uid !== "string" || e.uid.length === 0) {
    errors.push("uid must be a non-empty string");
  }
  if (typeof e.title !== "string" || e.title.length === 0) {
    errors.push("title must be a non-empty string");
  }
  if (!isISOUTC(e.start)) {
    errors.push(
      "start must be an ISO-8601 UTC string ending in Z (e.g. '2026-04-28T19:00:00Z')",
    );
  }
  if (!isISOUTC(e.end)) {
    errors.push("end must be an ISO-8601 UTC string ending in Z");
  }

  if (!e.soccer || typeof e.soccer !== "object") {
    errors.push("soccer typed_block is required for soccer events");
  } else {
    const s = e.soccer as Partial<SoccerTypedBlock>;
    if (s.home !== null && typeof s.home !== "string") {
      errors.push("soccer.home must be string or null (TBD)");
    }
    if (s.away !== null && typeof s.away !== "string") {
      errors.push("soccer.away must be string or null (TBD)");
    }
    if (!isSoccerStage(s.stage)) {
      errors.push(
        `soccer.stage must be one of: ${stageOrder.join(", ")}`,
      );
    }
    if (s.leg !== undefined && s.leg !== 1 && s.leg !== 2) {
      errors.push("soccer.leg must be 1, 2, or undefined");
    }
    if (
      s.match_number !== undefined &&
      (typeof s.match_number !== "number" || !Number.isInteger(s.match_number))
    ) {
      errors.push("soccer.match_number must be an integer or undefined");
    }
  }

  return { ok: errors.length === 0, errors };
}
