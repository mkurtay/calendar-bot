// F1 session types. Maps to `event.formula1.session`. SprintQualifying
// is the Saturday-morning session that sets the Sprint grid;
// SprintShootout was its predecessor name (2023-2024) — kept for
// historical data compatibility.

export type F1Session =
  | "FP1"
  | "FP2"
  | "FP3"
  | "SprintQualifying"
  | "SprintShootout"
  | "Sprint"
  | "Qualifying"
  | "Race";

export const sessionOrder: readonly F1Session[] = [
  "FP1",
  "FP2",
  "FP3",
  "SprintQualifying",
  "SprintShootout",
  "Sprint",
  "Qualifying",
  "Race",
];

export function isF1Session(value: unknown): value is F1Session {
  return (
    typeof value === "string" &&
    (sessionOrder as readonly string[]).includes(value)
  );
}
