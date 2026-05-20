// Auto-updater orchestration: for each tracked calendar, fetch its
// competition's finished matches from football-data.org, map them to
// calendar events, and commit any new/changed results. Result-only —
// never adds events or changes structure (that stays manual via chat).
//
// Run by .github/workflows/auto-update.yml on a 6h cron. Reuses the
// same FootballDataClient + CalendarStore + GitHub modules as the MCP
// server, so there's one source of truth for the data layer.

import { CalendarStore, type CalendarEvent } from "../calendar-store.js";
import { GitHub } from "../github.js";
import { FootballDataClient } from "../football-data/client.js";
import {
  computeResultUpdates,
  type FdFinishedMatch,
} from "./match.js";

/**
 * Calendars the auto-updater maintains, mapped to their football-data
 * competition code + season (the season's starting year). Add an entry
 * here to bring a calendar under auto-update. F1 isn't here —
 * football-data is soccer-only; F1 needs a separate data source.
 */
export interface TrackedCalendar {
  calendarId: string;
  competition: string;
  season: number;
}

export const TRACKED: TrackedCalendar[] = [
  { calendarId: "champions-league-2026", competition: "CL", season: 2025 },
  { calendarId: "world-cup-2026", competition: "WC", season: 2026 },
];

interface FdApiMatch {
  utcDate: string;
  status: string;
  score: { fullTime: { home: number | null; away: number | null } };
  homeTeam: { name: string; shortName: string | null; tla: string | null };
  awayTeam: { name: string; shortName: string | null; tla: string | null };
}

interface UpdateSummary {
  calendarId: string;
  updated: number;
  commitUrl?: string;
  skipped?: string;
}

export interface RunDeps {
  store: CalendarStore;
  fd: FootballDataClient;
}

/** Build RunDeps from env. Throws if required tokens are missing. */
export function depsFromEnv(): RunDeps {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN env var required");
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    throw new Error("FOOTBALL_DATA_TOKEN env var required");
  }
  const gh = new GitHub({
    owner: process.env.GITHUB_OWNER ?? "mkurtay",
    repo: process.env.GITHUB_REPO ?? "cal",
    branch: process.env.GITHUB_BRANCH ?? "main",
    token,
  });
  return {
    store: new CalendarStore(gh),
    fd: new FootballDataClient(process.env.FOOTBALL_DATA_TOKEN),
  };
}

/**
 * Process one tracked calendar: fetch finished matches, compute result
 * updates, and commit if any. Returns a summary. Errors on a single
 * calendar are caught by the caller so one bad competition doesn't
 * abort the whole run.
 */
export async function updateOne(
  deps: RunDeps,
  tracked: TrackedCalendar,
): Promise<UpdateSummary> {
  const { store, fd } = deps;
  const { calendar, sha } = await store.getCalendar(tracked.calendarId);

  const data = await fd.fetch<{ matches: FdApiMatch[] }>(
    `/competitions/${encodeURIComponent(tracked.competition)}/matches`,
    { status: "FINISHED", season: tracked.season },
  );

  const finished: FdFinishedMatch[] = data.matches
    .filter(
      (m) =>
        m.score.fullTime.home !== null && m.score.fullTime.away !== null,
    )
    .map((m) => ({
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      utcDate: m.utcDate,
      homeScore: m.score.fullTime.home as number,
      awayScore: m.score.fullTime.away as number,
    }));

  const updates = computeResultUpdates(finished, calendar.events);
  if (updates.length === 0) {
    return { calendarId: tracked.calendarId, updated: 0 };
  }

  // Apply updates in-place: set result + mark completed.
  const byUid = new Map(updates.map((u) => [u.uid, u]));
  for (const event of calendar.events as CalendarEvent[]) {
    const u = byUid.get(event.uid);
    if (!u) continue;
    event.result = { home_score: u.homeScore, away_score: u.awayScore };
    event.status = "completed";
  }

  const subjects = updates
    .map((u) => `${u.uid} ${u.homeScore}-${u.awayScore}`)
    .join(", ");
  const message =
    updates.length === 1
      ? `auto: result ${subjects}`
      : `auto: ${updates.length} results from football-data.org\n\n${subjects}`;

  const { commitUrl } = await store.saveCalendar(calendar, sha, message);
  return { calendarId: tracked.calendarId, updated: updates.length, commitUrl };
}

/** Process every tracked calendar. Per-calendar failures are isolated. */
export async function runAutoUpdate(
  deps: RunDeps,
  tracked: TrackedCalendar[] = TRACKED,
): Promise<UpdateSummary[]> {
  const summaries: UpdateSummary[] = [];
  for (const t of tracked) {
    try {
      summaries.push(await updateOne(deps, t));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summaries.push({ calendarId: t.calendarId, updated: 0, skipped: msg });
    }
  }
  return summaries;
}
