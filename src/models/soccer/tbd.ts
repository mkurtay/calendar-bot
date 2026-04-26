import type { SoccerEvent } from "./index.js";

// True when one or both teams are unresolved (pre-draw fixtures, e.g.
// World Cup 2026 before the December 5, 2025 group draw).
export function isTBD(event: SoccerEvent): boolean {
  return event.soccer.home === null || event.soccer.away === null;
}

// Display string for HTML/ICS rendering: "Mexico vs TBD", "TBD vs TBD".
// Renderers should call this rather than constructing titles ad-hoc so
// post-draw `update_calendar` runs rewrite consistently.
export function tbdTitle(event: SoccerEvent): string {
  const home = event.soccer.home ?? "TBD";
  const away = event.soccer.away ?? "TBD";
  return `${home} vs ${away}`;
}
