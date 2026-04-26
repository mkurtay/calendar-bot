import type { SoccerEvent } from "./index.js";
import { koLegStages } from "./stages.js";

// Stable team-pair key: alphabetical order so the same two clubs map
// to the same key regardless of which played host first.
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("||");
}

function isKoLegStage(stage: string): boolean {
  return (koLegStages as readonly string[]).includes(stage);
}

// Pairs up KO ties in the events list (same stage + same two teams)
// and assigns leg=1 to the earlier match, leg=2 to the later. Skips
// events that are TBD (one team null) or aren't in a leg-bearing
// stage. Non-touched events pass through unchanged.
//
// Returned array is the same length and order as the input — we only
// rewrite the `soccer.leg` field on matched events.
export function deriveLegs(events: SoccerEvent[]): SoccerEvent[] {
  const buckets = new Map<string, SoccerEvent[]>();

  for (const event of events) {
    const { stage, home, away } = event.soccer;
    if (!isKoLegStage(stage)) continue;
    if (!home || !away) continue;
    const key = `${stage}|${pairKey(home, away)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.push(event);
    } else {
      buckets.set(key, [event]);
    }
  }

  const legByUid = new Map<string, 1 | 2>();
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < Math.min(bucket.length, 2); i++) {
      const event = bucket[i];
      if (event) legByUid.set(event.uid, (i + 1) as 1 | 2);
    }
  }

  return events.map((event) => {
    const leg = legByUid.get(event.uid);
    if (leg === undefined) return event;
    return { ...event, soccer: { ...event.soccer, leg } };
  });
}
