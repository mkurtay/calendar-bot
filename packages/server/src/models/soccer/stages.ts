// Soccer stages. We normalize incoming source data (football-data.org
// enums and api-football strings) into a single canonical `SoccerStage`
// alphabet that the rest of the system (renderer, leg derivation,
// validators) can rely on.

export type SoccerStage =
  // Group stage of group-phase cups (e.g. World Cup).
  | "Group"
  // League stage of Swiss-system cups (e.g. UCL 2024-25+).
  | "LeaguePhase"
  // Pure league competitions (e.g. Premier League, Süper Lig).
  // Distinct from LeaguePhase to keep the renderer's type→layout
  // dispatch unambiguous.
  | "LeaguePlay"
  | "R32"
  | "R16"
  | "Quarterfinal"
  | "Semifinal"
  | "ThirdPlace"
  | "Final";

export const stageOrder: readonly SoccerStage[] = [
  "Group",
  "LeaguePhase",
  "LeaguePlay",
  "R32",
  "R16",
  "Quarterfinal",
  "Semifinal",
  "ThirdPlace",
  "Final",
];

// Stages that have two-leg ties. Final and ThirdPlace are single
// matches in current UCL/WC formats.
export const koLegStages: readonly SoccerStage[] = [
  "R32",
  "R16",
  "Quarterfinal",
  "Semifinal",
];

const STAGE_ALIASES = new Map<string, SoccerStage>([
  // canonical
  ["Group", "Group"],
  ["LeaguePhase", "LeaguePhase"],
  ["R32", "R32"],
  ["R16", "R16"],
  ["Quarterfinal", "Quarterfinal"],
  ["Semifinal", "Semifinal"],
  ["ThirdPlace", "ThirdPlace"],
  ["Final", "Final"],
  // football-data.org
  ["GROUP_STAGE", "Group"],
  ["LEAGUE_STAGE", "LeaguePhase"],
  ["LAST_32", "R32"],
  ["LAST_16", "R16"],
  ["QUARTER_FINALS", "Quarterfinal"],
  ["SEMI_FINALS", "Semifinal"],
  ["THIRD_PLACE", "ThirdPlace"],
  ["FINAL", "Final"],
  // api-football and common prose
  ["Group Stage", "Group"],
  ["League Stage", "LeaguePhase"],
  ["League Phase", "LeaguePhase"],
  // Pure-league aliases. Per-round identification (matchweek number)
  // belongs in event.soccer.matchday, not in the stage value itself.
  ["League Play", "LeaguePlay"],
  ["REGULAR_SEASON", "LeaguePlay"],
  ["Regular Season", "LeaguePlay"],
  ["Round of 32", "R32"],
  ["Round of 16", "R16"],
  ["Quarter-finals", "Quarterfinal"],
  ["Quarterfinals", "Quarterfinal"],
  ["Quarter finals", "Quarterfinal"],
  ["Semi-finals", "Semifinal"],
  ["Semifinals", "Semifinal"],
  ["Semi finals", "Semifinal"],
  ["Third place", "ThirdPlace"],
  ["Third-place match", "ThirdPlace"],
  ["3rd place", "ThirdPlace"],
]);

export function normalizeStage(api: string): SoccerStage {
  const direct = STAGE_ALIASES.get(api);
  if (direct) return direct;

  const lc = api.toLowerCase();
  for (const [key, value] of STAGE_ALIASES) {
    if (key.toLowerCase() === lc) return value;
  }

  throw new Error(`Unknown soccer stage: ${JSON.stringify(api)}`);
}

export function isSoccerStage(value: unknown): value is SoccerStage {
  return (
    typeof value === "string" &&
    (stageOrder as readonly string[]).includes(value)
  );
}

export function stageRank(stage: SoccerStage): number {
  return stageOrder.indexOf(stage);
}
