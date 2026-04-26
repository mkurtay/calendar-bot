import { isISOUTC, type ValidationResult } from "../types.js";
import {
  isSoccerCalendarType,
  TEAM_ID_REGEX,
  type SoccerCalendar,
  type SoccerCalendarType,
  type SoccerEvent,
  type SoccerTypedBlock,
  type Team,
} from "./index.js";
import { isSoccerStage, stageOrder } from "./stages.js";
import { validateSoccerResult } from "./result.js";

// Validates an unknown value claims to be a SoccerEvent. Used by the
// create_calendar / update_calendar tools to reject malformed input
// before it reaches GitHub commits. Cross-rules involving Calendar
// context (type discriminator, team-id references) live in
// validateSoccerCalendar.
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
      errors.push(`soccer.stage must be one of: ${stageOrder.join(", ")}`);
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
    if (
      s.matchday !== undefined &&
      (typeof s.matchday !== "number" ||
        !Number.isInteger(s.matchday) ||
        s.matchday < 1)
    ) {
      errors.push("soccer.matchday must be a positive integer");
    }
    if (
      s.home_id !== undefined &&
      (typeof s.home_id !== "string" || !TEAM_ID_REGEX.test(s.home_id))
    ) {
      errors.push(
        "soccer.home_id must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/",
      );
    }
    if (
      s.away_id !== undefined &&
      (typeof s.away_id !== "string" || !TEAM_ID_REGEX.test(s.away_id))
    ) {
      errors.push(
        "soccer.away_id must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/",
      );
    }
  }

  // Validate result shape when set (null and undefined are both fine).
  if (e.result !== undefined && e.result !== null) {
    const resultResult = validateSoccerResult(e.result);
    if (!resultResult.ok) {
      for (const msg of resultResult.errors) errors.push(msg);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Validates a SoccerCalendar in full, including cross-rules that
// require Calendar context: type discriminator, teams[] uniqueness,
// home_id/away_id references resolving against teams[], and
// type→stage compatibility (e.g. type="league" → every event has
// stage="LeaguePlay"). Per-event field validation delegates to
// validateSoccerEvent.
//
// Backward compatibility: when type and teams are absent, the
// cross-rules involving them are skipped, so calendars that pre-date
// this feature still validate.
export function validateSoccerCalendar(calendar: unknown): ValidationResult {
  const errors: string[] = [];

  if (!calendar || typeof calendar !== "object") {
    return { ok: false, errors: ["calendar must be an object"] };
  }

  const c = calendar as Partial<SoccerCalendar>;

  // Calendar-level type discriminator (optional).
  let type: SoccerCalendarType | undefined;
  if (c.type !== undefined) {
    if (!isSoccerCalendarType(c.type)) {
      errors.push("type must be one of: league, cup_groups, cup_swiss");
    } else {
      type = c.type;
    }
  }

  // Teams registry (optional). Validates id format + uniqueness +
  // each team has a non-empty name.
  const teamIds = new Set<string>();
  if (c.teams !== undefined) {
    if (!Array.isArray(c.teams)) {
      errors.push("teams must be an array");
    } else {
      for (let i = 0; i < c.teams.length; i++) {
        const team = c.teams[i] as Partial<Team> | undefined;
        if (!team || typeof team !== "object") {
          errors.push(`teams[${i}]: must be an object`);
          continue;
        }
        if (typeof team.id !== "string" || !TEAM_ID_REGEX.test(team.id)) {
          errors.push(
            `teams[${i}].id must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`,
          );
        } else if (teamIds.has(team.id)) {
          errors.push(`teams[${i}].id "${team.id}" is duplicated`);
        } else {
          teamIds.add(team.id);
        }
        if (typeof team.name !== "string" || team.name.length === 0) {
          errors.push(`teams[${i}].name must be a non-empty string`);
        }
      }
    }
  }

  // Events array.
  if (!Array.isArray(c.events)) {
    return { ok: false, errors: [...errors, "events must be an array"] };
  }

  // Per-event validation (delegated). Then cross-rules against type
  // and teams[].
  for (let i = 0; i < c.events.length; i++) {
    const eventResult = validateSoccerEvent(c.events[i]);
    if (!eventResult.ok) {
      for (const msg of eventResult.errors) {
        errors.push(`events[${i}]: ${msg}`);
      }
    }
  }

  // Cross-rule: home_id/away_id must reference an existing team
  // (only enforced when teams[] is provided).
  if (c.teams !== undefined && teamIds.size > 0) {
    for (let i = 0; i < c.events.length; i++) {
      const e = c.events[i] as Partial<SoccerEvent> | undefined;
      const s = e?.soccer as Partial<SoccerTypedBlock> | undefined;
      if (s?.home_id && !teamIds.has(s.home_id)) {
        errors.push(
          `events[${i}].soccer.home_id "${s.home_id}" is not in teams[]`,
        );
      }
      if (s?.away_id && !teamIds.has(s.away_id)) {
        errors.push(
          `events[${i}].soccer.away_id "${s.away_id}" is not in teams[]`,
        );
      }
    }
  }

  // Cross-rule: type → stage compatibility (only enforced when type
  // is set; backward compatible).
  if (type !== undefined) {
    for (let i = 0; i < c.events.length; i++) {
      const e = c.events[i] as Partial<SoccerEvent> | undefined;
      const s = e?.soccer as Partial<SoccerTypedBlock> | undefined;
      if (!s || s.stage === undefined) continue;

      if (type === "league") {
        if (s.stage !== "LeaguePlay") {
          errors.push(
            `events[${i}].soccer.stage must be "LeaguePlay" for type="league" calendars (got "${s.stage}")`,
          );
        }
      } else if (type === "cup_groups") {
        if (s.stage === "Group") {
          if (typeof s.group !== "string" || s.group.length === 0) {
            errors.push(
              `events[${i}].soccer.group required when stage is "Group" for type="cup_groups"`,
            );
          }
          if (s.matchday === undefined) {
            errors.push(
              `events[${i}].soccer.matchday required when stage is "Group" for type="cup_groups"`,
            );
          }
        }
        if (s.stage === "LeaguePhase" || s.stage === "LeaguePlay") {
          errors.push(
            `events[${i}].soccer.stage "${s.stage}" is not valid for type="cup_groups" (use "Group" + group letter for group-stage matches)`,
          );
        }
      } else if (type === "cup_swiss") {
        if (s.stage === "LeaguePhase") {
          if (s.matchday === undefined) {
            errors.push(
              `events[${i}].soccer.matchday required when stage is "LeaguePhase" for type="cup_swiss"`,
            );
          }
        }
        if (s.stage === "Group" || s.stage === "LeaguePlay") {
          errors.push(
            `events[${i}].soccer.stage "${s.stage}" is not valid for type="cup_swiss" (use "LeaguePhase" for the league stage or a knockout stage)`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
