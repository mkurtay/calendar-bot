// Soccer-concrete result shape. The base Event.result is
// `Record<string, unknown> | null` (opaque to the diff engine);
// each category narrows it. SoccerResult uses a discriminated union
// so the type system enforces "penalties present iff status === 'pen'"
// — code that reads result.penalties on a "pen" result doesn't need
// optional chaining, and accidentally adding penalties to a non-pen
// result is a compile error.

import type { ValidationResult } from "../types.js";

export type SoccerResult =
  | {
      home_score: number;
      away_score: number;
      status?: "ft" | "aet";
    }
  | {
      home_score: number;
      away_score: number;
      status: "pen";
      penalties: { home: number; away: number };
    };

const FINAL_STATUSES = ["ft", "aet", "pen"] as const;

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

export function validateSoccerResult(result: unknown): ValidationResult {
  const errors: string[] = [];

  if (!result || typeof result !== "object") {
    return { ok: false, errors: ["result must be an object"] };
  }

  const r = result as Record<string, unknown>;

  if (!isNonNegativeInteger(r["home_score"])) {
    errors.push("result.home_score must be a non-negative integer");
  }
  if (!isNonNegativeInteger(r["away_score"])) {
    errors.push("result.away_score must be a non-negative integer");
  }

  const status = r["status"];
  if (
    status !== undefined &&
    !(FINAL_STATUSES as readonly string[]).includes(status as string)
  ) {
    errors.push(`result.status must be one of: ${FINAL_STATUSES.join(", ")}`);
  }

  const penalties = r["penalties"];
  if (status === "pen") {
    if (penalties === undefined) {
      errors.push('result.penalties is required when status is "pen"');
    } else if (!penalties || typeof penalties !== "object") {
      errors.push("result.penalties must be an object");
    } else {
      const p = penalties as Record<string, unknown>;
      if (!isNonNegativeInteger(p["home"])) {
        errors.push("result.penalties.home must be a non-negative integer");
      }
      if (!isNonNegativeInteger(p["away"])) {
        errors.push("result.penalties.away must be a non-negative integer");
      }
    }
  } else if (penalties !== undefined) {
    errors.push('result.penalties is only allowed when status is "pen"');
  }

  return { ok: errors.length === 0, errors };
}
