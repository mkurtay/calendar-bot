import type { F1Event } from "../../models/formula1/index.js";
import { isF1Session } from "../../models/formula1/sessions.js";
import { validateF1Event } from "../../models/formula1/validators.js";

function makeEvent(
  overrides: Omit<Partial<F1Event>, "formula1"> & {
    formula1?: Partial<F1Event["formula1"]>;
  } = {},
): F1Event {
  return {
    uid: overrides.uid ?? "f1-2026-r1-race",
    title: overrides.title ?? "Australian GP",
    start: overrides.start ?? "2026-03-08T04:00:00Z",
    end: overrides.end ?? "2026-03-08T06:00:00Z",
    formula1: {
      round: overrides.formula1?.round ?? 1,
      gp_name: overrides.formula1?.gp_name ?? "Australian Grand Prix",
      session: overrides.formula1?.session ?? "Race",
      ...overrides.formula1,
    },
  };
}

describe("isF1Session", () => {
  it("accepts every canonical session name", () => {
    expect(isF1Session("FP1")).toBe(true);
    expect(isF1Session("FP2")).toBe(true);
    expect(isF1Session("FP3")).toBe(true);
    expect(isF1Session("Qualifying")).toBe(true);
    expect(isF1Session("Sprint")).toBe(true);
    expect(isF1Session("SprintQualifying")).toBe(true);
    expect(isF1Session("SprintShootout")).toBe(true);
    expect(isF1Session("Race")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isF1Session("Practice 1")).toBe(false);
    expect(isF1Session("")).toBe(false);
    expect(isF1Session(undefined)).toBe(false);
    expect(isF1Session(1)).toBe(false);
  });
});

describe("validateF1Event", () => {
  it("accepts a fully-formed event", () => {
    expect(validateF1Event(makeEvent())).toEqual({ ok: true, errors: [] });
  });

  it("rejects non-objects", () => {
    expect(validateF1Event(null).ok).toBe(false);
    expect(validateF1Event("not an event").ok).toBe(false);
  });

  it("rejects missing formula1.round (the Rundefined regression)", () => {
    const e = makeEvent();
    delete (e.formula1 as { round?: number }).round;
    const r = validateF1Event(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("formula1.round"))).toBe(true);
  });

  it("rejects non-integer or non-positive round", () => {
    expect(validateF1Event(makeEvent({ formula1: { round: 0 } })).ok).toBe(false);
    expect(validateF1Event(makeEvent({ formula1: { round: -3 } })).ok).toBe(false);
    expect(validateF1Event(makeEvent({ formula1: { round: 1.5 } })).ok).toBe(false);
  });

  it("rejects missing gp_name", () => {
    const e = makeEvent();
    e.formula1.gp_name = "";
    const r = validateF1Event(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("gp_name"))).toBe(true);
  });

  it("rejects unknown session", () => {
    const e = makeEvent();
    (e.formula1 as { session: string }).session = "Practice 1";
    const r = validateF1Event(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("session"))).toBe(true);
  });

  it("rejects non-boolean is_sprint_weekend", () => {
    const e = makeEvent();
    (e.formula1 as { is_sprint_weekend: unknown }).is_sprint_weekend = "yes";
    expect(validateF1Event(e).ok).toBe(false);
  });

  it("requires the formula1 typed_block", () => {
    const e: Partial<F1Event> = makeEvent();
    delete (e as { formula1?: unknown }).formula1;
    const r = validateF1Event(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("formula1 typed_block"))).toBe(true);
  });

  it("requires ISO-UTC start/end ending in Z", () => {
    const e = { ...makeEvent(), start: "2026-03-08T04:00:00+10:00" };
    expect(validateF1Event(e).ok).toBe(false);
  });
});
