import { isISOUTC, type ValidationResult } from "../types.js";
import type { F1Event, F1TypedBlock } from "./index.js";
import { isF1Session, sessionOrder } from "./sessions.js";

// Validates an unknown value claims to be an F1Event. The required
// `formula1.round` check is what would have caught the "Rundefined"
// regression that prompted the renderer-side throw earlier in Phase 1.
export function validateF1Event(event: unknown): ValidationResult {
  const errors: string[] = [];

  if (!event || typeof event !== "object") {
    return { ok: false, errors: ["event must be an object"] };
  }

  const e = event as Partial<F1Event>;

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

  if (!e.formula1 || typeof e.formula1 !== "object") {
    errors.push("formula1 typed_block is required for formula1 events");
  } else {
    const f = e.formula1 as Partial<F1TypedBlock>;
    if (
      typeof f.round !== "number" ||
      !Number.isInteger(f.round) ||
      f.round < 1
    ) {
      errors.push("formula1.round must be a positive integer");
    }
    if (typeof f.gp_name !== "string" || f.gp_name.length === 0) {
      errors.push("formula1.gp_name must be a non-empty string");
    }
    if (!isF1Session(f.session)) {
      errors.push(
        `formula1.session must be one of: ${sessionOrder.join(", ")}`,
      );
    }
    if (
      f.is_sprint_weekend !== undefined &&
      typeof f.is_sprint_weekend !== "boolean"
    ) {
      errors.push("formula1.is_sprint_weekend must be boolean or undefined");
    }
  }

  return { ok: errors.length === 0, errors };
}
