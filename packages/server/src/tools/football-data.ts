// MCP tools that proxy football-data.org v4. Read-only — the agent
// loop in chat-lambda runs these silently (no canUseTool gate) so the
// bot can pull live results/standings/scorers without prompting the
// user.

import { makeFootballDataClient } from "../football-data/client.js";

// Slimmed-down shapes from the football-data.org API. We don't model
// every field — just what the tools actually return downstream.
interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string;
  group: string | null;
  homeTeam: { id: number; name: string; shortName: string | null };
  awayTeam: { id: number; name: string; shortName: string | null };
  score: {
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    winner: string | null;
    duration: string;
  };
}

interface FdStandingRow {
  position: number;
  team: { id: number; name: string };
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

interface FdScorer {
  player: { id: number; name: string; nationality?: string };
  team: { id: number; name: string };
  goals: number;
  assists?: number | null;
  penalties?: number | null;
  playedMatches?: number;
}

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

function jsonText(value: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

// ─────────────────────────────────────────────────────────────────
// fetch_competition_matches
// ─────────────────────────────────────────────────────────────────

export const FETCH_COMPETITION_MATCHES_TOOL = {
  name: "fetch_competition_matches",
  description:
    "Fetch real match data from football-data.org for a competition. " +
    "Use when the user asks about results, fixtures, kickoff times, or scores. " +
    "Status filter is the most useful knob: 'FINISHED' for completed matches with " +
    "scores, 'SCHEDULED' for upcoming, 'IN_PLAY' for live. Returns id, utcDate, " +
    "status, matchday, stage, group, home/awayTeam names, score.fullTime, " +
    "score.winner.\n\n" +
    "Common competition codes (free tier subset): CL (UCL), CLI (Conference " +
    "League), EC (Euros), WC (World Cup), PL (Premier League), BL1 (Bundesliga), " +
    "SA (Serie A), PD (La Liga), FL1 (Ligue 1), DED (Eredivisie), PPL (Primeira " +
    "Liga), BSA (Brasileirao).",
  inputSchema: {
    type: "object",
    properties: {
      competition: {
        type: "string",
        description: "Competition code (e.g. CL, PL, WC).",
      },
      status: {
        type: "string",
        enum: [
          "SCHEDULED",
          "TIMED",
          "IN_PLAY",
          "PAUSED",
          "FINISHED",
          "POSTPONED",
          "SUSPENDED",
          "CANCELED",
        ],
        description: "FINISHED for results; SCHEDULED for upcoming.",
      },
      matchday: { type: "number", description: "Specific matchday/round." },
      dateFrom: { type: "string", description: "YYYY-MM-DD lower bound." },
      dateTo: { type: "string", description: "YYYY-MM-DD upper bound." },
      stage: {
        type: "string",
        description:
          "Knockout stage filter (e.g. SEMI_FINALS, FINAL, QUARTER_FINALS).",
      },
      season: {
        type: "number",
        description: "Starting year of the season (e.g. 2025 for 2025-26).",
      },
    },
    required: ["competition"],
    additionalProperties: false,
  },
} as const;

export interface FetchCompetitionMatchesParams {
  competition: string;
  status?: string;
  matchday?: number;
  dateFrom?: string;
  dateTo?: string;
  stage?: string;
  season?: number;
}

export async function fetchCompetitionMatches(
  params: FetchCompetitionMatchesParams,
): Promise<McpToolResult> {
  const client = makeFootballDataClient();
  const data = await client.fetch<{ matches: FdMatch[] }>(
    `/competitions/${encodeURIComponent(params.competition)}/matches`,
    {
      status: params.status,
      matchday: params.matchday,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      stage: params.stage,
      season: params.season,
    },
  );
  return jsonText({
    count: data.matches.length,
    matches: data.matches.map((m) => ({
      id: m.id,
      utcDate: m.utcDate,
      status: m.status,
      matchday: m.matchday,
      stage: m.stage,
      group: m.group,
      homeTeam: m.homeTeam.shortName || m.homeTeam.name,
      awayTeam: m.awayTeam.shortName || m.awayTeam.name,
      homeTeamId: m.homeTeam.id,
      awayTeamId: m.awayTeam.id,
      score: {
        home: m.score.fullTime.home,
        away: m.score.fullTime.away,
        winner: m.score.winner,
        halfTime: m.score.halfTime,
      },
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// fetch_competition_standings
// ─────────────────────────────────────────────────────────────────

export const FETCH_COMPETITION_STANDINGS_TOOL = {
  name: "fetch_competition_standings",
  description:
    "Fetch league standings/table for a competition. Best for league formats " +
    "(PL, BL1, SA, PD, FL1) and the UCL LeaguePhase table. Returns: position, " +
    "team name, played, W/D/L, GF/GA/GD, points.",
  inputSchema: {
    type: "object",
    properties: {
      competition: { type: "string" },
      season: { type: "number" },
      matchday: { type: "number" },
    },
    required: ["competition"],
    additionalProperties: false,
  },
} as const;

export interface FetchCompetitionStandingsParams {
  competition: string;
  season?: number;
  matchday?: number;
}

export async function fetchCompetitionStandings(
  params: FetchCompetitionStandingsParams,
): Promise<McpToolResult> {
  const client = makeFootballDataClient();
  const data = await client.fetch<{
    competition: { name: string };
    season: { currentMatchday: number };
    standings: Array<{
      type: string;
      stage: string;
      group: string | null;
      table: FdStandingRow[];
    }>;
  }>(`/competitions/${encodeURIComponent(params.competition)}/standings`, {
    season: params.season,
    matchday: params.matchday,
  });
  return jsonText({
    competition: data.competition.name,
    currentMatchday: data.season.currentMatchday,
    standings: data.standings.map((s) => ({
      type: s.type,
      stage: s.stage,
      group: s.group,
      table: s.table.map((row) => ({
        position: row.position,
        team: row.team.name,
        teamId: row.team.id,
        played: row.playedGames,
        won: row.won,
        draw: row.draw,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference,
        points: row.points,
      })),
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// fetch_team_fixtures
// ─────────────────────────────────────────────────────────────────

export const FETCH_TEAM_FIXTURES_TOOL = {
  name: "fetch_team_fixtures",
  description:
    "Fetch matches for a specific team across one or more competitions. Pass " +
    "the team by NAME (e.g. 'Arsenal', 'Real Madrid'); the tool resolves it via " +
    "the football-data /teams search. Provide a competition code to narrow the " +
    "name resolution (recommended) — otherwise it searches globally. Returns " +
    "the same match shape as fetch_competition_matches.",
  inputSchema: {
    type: "object",
    properties: {
      team: { type: "string", description: "Team name (case-insensitive)." },
      competition: {
        type: "string",
        description:
          "Limit search to a competition code. Speeds resolution dramatically.",
      },
      status: {
        type: "string",
        enum: [
          "SCHEDULED",
          "TIMED",
          "IN_PLAY",
          "PAUSED",
          "FINISHED",
          "POSTPONED",
          "SUSPENDED",
          "CANCELED",
        ],
      },
      dateFrom: { type: "string" },
      dateTo: { type: "string" },
      limit: { type: "number", description: "Max matches (default 20)." },
    },
    required: ["team"],
    additionalProperties: false,
  },
} as const;

export interface FetchTeamFixturesParams {
  team: string;
  competition?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export async function fetchTeamFixtures(
  params: FetchTeamFixturesParams,
): Promise<McpToolResult> {
  const client = makeFootballDataClient();
  // Resolve team id by name. Within-competition search is much
  // smaller (~20-30 teams) and almost never ambiguous; global search
  // is broader and may return collisions across leagues.
  const target = params.team.toLowerCase();
  let teamId: number;
  let resolvedName: string;
  if (params.competition) {
    const data = await client.fetch<{
      teams: Array<{ id: number; name: string; shortName: string | null }>;
    }>(`/competitions/${encodeURIComponent(params.competition)}/teams`);
    const match = data.teams.find(
      (t) =>
        t.name.toLowerCase().includes(target) ||
        (t.shortName?.toLowerCase().includes(target) ?? false),
    );
    if (!match) {
      throw new Error(
        `No team matching "${params.team}" in competition ${params.competition}`,
      );
    }
    teamId = match.id;
    resolvedName = match.name;
  } else {
    const data = await client.fetch<{
      teams: Array<{ id: number; name: string }>;
    }>(`/teams`, { name: params.team, limit: 5 });
    if (data.teams.length === 0) {
      throw new Error(`No team matching "${params.team}" found.`);
    }
    const first = data.teams[0];
    if (!first) throw new Error(`No team matching "${params.team}" found.`);
    teamId = first.id;
    resolvedName = first.name;
  }
  const data = await client.fetch<{ matches: FdMatch[] }>(
    `/teams/${teamId}/matches`,
    {
      status: params.status,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      limit: params.limit ?? 20,
    },
  );
  return jsonText({
    team: resolvedName,
    teamId,
    count: data.matches.length,
    matches: data.matches.map((m) => ({
      id: m.id,
      utcDate: m.utcDate,
      status: m.status,
      matchday: m.matchday,
      stage: m.stage,
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      score: {
        home: m.score.fullTime.home,
        away: m.score.fullTime.away,
        winner: m.score.winner,
      },
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// fetch_competition_scorers
// ─────────────────────────────────────────────────────────────────

export const FETCH_COMPETITION_SCORERS_TOOL = {
  name: "fetch_competition_scorers",
  description:
    "Fetch top scorers for a competition. Returns ranked list with goals, " +
    "assists, penalties, played matches.",
  inputSchema: {
    type: "object",
    properties: {
      competition: { type: "string" },
      season: { type: "number" },
      limit: { type: "number", description: "Max scorers (default 10)." },
    },
    required: ["competition"],
    additionalProperties: false,
  },
} as const;

export interface FetchCompetitionScorersParams {
  competition: string;
  season?: number;
  limit?: number;
}

export async function fetchCompetitionScorers(
  params: FetchCompetitionScorersParams,
): Promise<McpToolResult> {
  const client = makeFootballDataClient();
  const data = await client.fetch<{ scorers: FdScorer[] }>(
    `/competitions/${encodeURIComponent(params.competition)}/scorers`,
    { season: params.season, limit: params.limit ?? 10 },
  );
  return jsonText({
    count: data.scorers.length,
    scorers: data.scorers.map((s, i) => ({
      rank: i + 1,
      player: s.player.name,
      team: s.team.name,
      goals: s.goals,
      assists: s.assists ?? 0,
      penalties: s.penalties ?? 0,
      playedMatches: s.playedMatches ?? 0,
    })),
  });
}
