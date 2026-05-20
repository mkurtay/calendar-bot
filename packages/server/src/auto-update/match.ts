// Deterministic match-to-event mapping for the auto-updater.
//
// No LLM here — this is a cron job. Given a football-data.org match
// (which carries name/shortName/tla per team + a UTC date) and a
// calendar's events, find the single event that represents the same
// fixture, so we can write its result. Mismatching would silently
// write a wrong score, so the matching is conservative: same UTC day
// + both teams matching, or no match at all.

import type { CalendarEvent } from "../calendar-store.js";

/** Strip diacritics + non-alphanumerics, lowercase. "Bayern München" → "bayernmunchen". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** football-data team identity (subset of the API's team object). */
export interface FdTeam {
  name: string;
  shortName?: string | null;
  tla?: string | null;
}

/** A finished football-data match reduced to what the matcher needs. */
export interface FdFinishedMatch {
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  /** ISO UTC kickoff. */
  utcDate: string;
  homeScore: number;
  awayScore: number;
}

/**
 * True if a football-data team and a calendar event-side refer to the
 * same club. Tries every (fd identifier × event identifier) pair:
 * exact normalized equality, or substring containment when both are
 * ≥4 chars (handles "Real Madrid CF" ⊇ "real-madrid", "FC Bayern
 * München" ⊇ "Bayern München"). The event's team-id slug is the most
 * reliable side (e.g. "psg" matches the TLA "PSG").
 */
export function teamMatch(
  fd: FdTeam,
  eventTeamName: string | undefined,
  eventTeamId: string | undefined,
): boolean {
  const fdCandidates = [fd.name, fd.shortName ?? "", fd.tla ?? ""]
    .map(norm)
    .filter(Boolean);
  const evCandidates = [eventTeamName ?? "", eventTeamId ?? ""]
    .map(norm)
    .filter(Boolean);
  for (const f of fdCandidates) {
    for (const e of evCandidates) {
      if (f === e) return true;
      if (f.length >= 4 && e.length >= 4 && (f.includes(e) || e.includes(f))) {
        return true;
      }
    }
  }
  return false;
}

function utcDay(iso: string): string {
  // "2026-05-06T19:00:00Z" → "2026-05-06"
  return iso.slice(0, 10);
}

/**
 * Find the calendar event matching a football-data match: same UTC
 * day, home matches home, away matches away. Returns null when there's
 * no confident match (caller skips rather than guesses).
 */
export function findMatchingEvent(
  fd: FdFinishedMatch,
  events: CalendarEvent[],
): CalendarEvent | null {
  const day = utcDay(fd.utcDate);
  for (const ev of events) {
    const soccer = ev.soccer as
      | { home?: string; away?: string; home_id?: string; away_id?: string }
      | undefined;
    if (!soccer) continue;
    if (utcDay(ev.start) !== day) continue;
    if (!teamMatch(fd.homeTeam, soccer.home, soccer.home_id)) continue;
    if (!teamMatch(fd.awayTeam, soccer.away, soccer.away_id)) continue;
    return ev;
  }
  return null;
}

export interface ResultUpdate {
  uid: string;
  homeScore: number;
  awayScore: number;
}

/** True if the event already carries exactly this score. */
function resultUnchanged(
  current: unknown,
  homeScore: number,
  awayScore: number,
): boolean {
  if (current == null || typeof current !== "object") return false;
  const r = current as { home_score?: unknown; away_score?: unknown };
  return r.home_score === homeScore && r.away_score === awayScore;
}

/**
 * Given finished football-data matches + a calendar's events, compute
 * the set of result updates to apply. Skips matches that don't map to
 * an event, and events that already carry the same score (so re-runs
 * are no-ops). Pure — no I/O.
 */
export function computeResultUpdates(
  finished: FdFinishedMatch[],
  events: CalendarEvent[],
): ResultUpdate[] {
  const updates: ResultUpdate[] = [];
  for (const fd of finished) {
    const ev = findMatchingEvent(fd, events);
    if (!ev) continue;
    if (resultUnchanged(ev.result, fd.homeScore, fd.awayScore)) continue;
    updates.push({
      uid: ev.uid,
      homeScore: fd.homeScore,
      awayScore: fd.awayScore,
    });
  }
  return updates;
}
