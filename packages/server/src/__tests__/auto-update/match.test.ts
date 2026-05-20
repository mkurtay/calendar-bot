import {
  norm,
  teamMatch,
  findMatchingEvent,
  computeResultUpdates,
  type FdFinishedMatch,
} from "../../auto-update/match.js";
import type { CalendarEvent } from "../../calendar-store.js";

function ev(partial: Partial<CalendarEvent> & { uid: string }): CalendarEvent {
  return {
    title: "",
    start: "2026-05-06T19:00:00Z",
    end: "2026-05-06T21:00:00Z",
    status: "scheduled",
    result: null,
    ...partial,
  } as CalendarEvent;
}

describe("norm", () => {
  it("strips diacritics, case, and non-alphanumerics", () => {
    expect(norm("Bayern München")).toBe("bayernmunchen");
    expect(norm("Real Madrid CF")).toBe("realmadridcf");
    expect(norm("PSG")).toBe("psg");
    expect(norm("Atlético Madrid")).toBe("atleticomadrid");
  });
});

describe("teamMatch", () => {
  it("matches event team-id slug against the TLA", () => {
    expect(teamMatch({ name: "Paris Saint-Germain FC", tla: "PSG" }, "PSG", "psg")).toBe(true);
  });

  it("matches full name containing the slug", () => {
    expect(teamMatch({ name: "Real Madrid CF" }, "Real Madrid", "real-madrid")).toBe(true);
  });

  it("matches across diacritics", () => {
    expect(teamMatch({ name: "FC Bayern München" }, "Bayern München", "bayern")).toBe(true);
  });

  it("does not match different clubs", () => {
    expect(teamMatch({ name: "Arsenal FC", tla: "ARS" }, "Atlético Madrid", "atletico")).toBe(false);
  });

  it("avoids short-substring false positives", () => {
    // "ac" should not match "Barcelona" via substring noise
    expect(teamMatch({ name: "AC", tla: "AC" }, "Barcelona", "barcelona")).toBe(false);
  });
});

describe("findMatchingEvent", () => {
  const events = [
    ev({
      uid: "sf-1",
      start: "2026-05-06T19:00:00Z",
      soccer: { home: "Bayern München", away: "PSG", home_id: "bayern", away_id: "psg" },
    } as Partial<CalendarEvent> & { uid: string }),
    ev({
      uid: "sf-2",
      start: "2026-05-05T19:00:00Z",
      soccer: { home: "Arsenal", away: "Atlético Madrid", home_id: "arsenal", away_id: "atletico" },
    } as Partial<CalendarEvent> & { uid: string }),
  ];

  it("finds the event with matching teams + same UTC day", () => {
    const fd: FdFinishedMatch = {
      homeTeam: { name: "FC Bayern München", tla: "FCB" },
      awayTeam: { name: "Paris Saint-Germain FC", tla: "PSG" },
      utcDate: "2026-05-06T19:00:00Z",
      homeScore: 1,
      awayScore: 1,
    };
    expect(findMatchingEvent(fd, events)?.uid).toBe("sf-1");
  });

  it("returns null when the day differs", () => {
    const fd: FdFinishedMatch = {
      homeTeam: { name: "FC Bayern München", tla: "FCB" },
      awayTeam: { name: "Paris Saint-Germain FC", tla: "PSG" },
      utcDate: "2026-05-07T19:00:00Z",
      homeScore: 1,
      awayScore: 1,
    };
    expect(findMatchingEvent(fd, events)).toBeNull();
  });

  it("returns null when teams don't match any event", () => {
    const fd: FdFinishedMatch = {
      homeTeam: { name: "Liverpool FC", tla: "LIV" },
      awayTeam: { name: "Chelsea FC", tla: "CHE" },
      utcDate: "2026-05-06T19:00:00Z",
      homeScore: 2,
      awayScore: 0,
    };
    expect(findMatchingEvent(fd, events)).toBeNull();
  });
});

describe("computeResultUpdates", () => {
  const events = [
    ev({
      uid: "sf-1",
      start: "2026-05-06T19:00:00Z",
      soccer: { home: "Bayern München", away: "PSG", home_id: "bayern", away_id: "psg" },
    } as Partial<CalendarEvent> & { uid: string }),
  ];

  it("produces an update for a finished match with no current result", () => {
    const fd: FdFinishedMatch[] = [
      {
        homeTeam: { name: "FC Bayern München", tla: "FCB" },
        awayTeam: { name: "Paris Saint-Germain FC", tla: "PSG" },
        utcDate: "2026-05-06T19:00:00Z",
        homeScore: 1,
        awayScore: 1,
      },
    ];
    expect(computeResultUpdates(fd, events)).toEqual([
      { uid: "sf-1", homeScore: 1, awayScore: 1 },
    ]);
  });

  it("is a no-op when the event already has the same score", () => {
    const withResult = [
      ev({
        uid: "sf-1",
        start: "2026-05-06T19:00:00Z",
        result: { home_score: 1, away_score: 1 },
        soccer: { home: "Bayern München", away: "PSG", home_id: "bayern", away_id: "psg" },
      } as Partial<CalendarEvent> & { uid: string }),
    ];
    const fd: FdFinishedMatch[] = [
      {
        homeTeam: { name: "FC Bayern München", tla: "FCB" },
        awayTeam: { name: "Paris Saint-Germain FC", tla: "PSG" },
        utcDate: "2026-05-06T19:00:00Z",
        homeScore: 1,
        awayScore: 1,
      },
    ];
    expect(computeResultUpdates(fd, withResult)).toEqual([]);
  });

  it("updates when the score changed (correction)", () => {
    const withResult = [
      ev({
        uid: "sf-1",
        start: "2026-05-06T19:00:00Z",
        result: { home_score: 0, away_score: 0 },
        soccer: { home: "Bayern München", away: "PSG", home_id: "bayern", away_id: "psg" },
      } as Partial<CalendarEvent> & { uid: string }),
    ];
    const fd: FdFinishedMatch[] = [
      {
        homeTeam: { name: "FC Bayern München", tla: "FCB" },
        awayTeam: { name: "Paris Saint-Germain FC", tla: "PSG" },
        utcDate: "2026-05-06T19:00:00Z",
        homeScore: 1,
        awayScore: 1,
      },
    ];
    expect(computeResultUpdates(fd, withResult)).toEqual([
      { uid: "sf-1", homeScore: 1, awayScore: 1 },
    ]);
  });
});
