import { TokenStore } from "../../diff/tokens.js";
import type { CalendarDiff } from "../../diff/types.js";

interface PendingDiff {
  calendarId: string;
  diff: CalendarDiff;
}

function emptyDiff(): CalendarDiff {
  return { entries: [], resolved: [], isNoop: true };
}

function pending(calendarId: string): PendingDiff {
  return { calendarId, diff: emptyDiff() };
}

describe("TokenStore", () => {
  it("returns a token from put() that consume() resolves to the same value", () => {
    const store = new TokenStore<PendingDiff>();
    const value = pending("ucl-2026");
    const token = store.put(value);
    const entry = store.consume(token);
    expect(entry).not.toBeNull();
    expect(entry?.calendarId).toBe("ucl-2026");
    expect(entry?.diff).toBe(value.diff);
  });

  it("issues distinct tokens for separate puts", () => {
    const store = new TokenStore<PendingDiff>();
    const t1 = store.put(pending("a"));
    const t2 = store.put(pending("b"));
    expect(t1).not.toBe(t2);
  });

  it("consume() is one-shot (second call returns null)", () => {
    const store = new TokenStore<PendingDiff>();
    const token = store.put(pending("ucl-2026"));
    expect(store.consume(token)).not.toBeNull();
    expect(store.consume(token)).toBeNull();
  });

  it("consume() returns null for unknown token", () => {
    const store = new TokenStore<PendingDiff>();
    expect(store.consume("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("expires entries after the configured TTL", () => {
    const store = new TokenStore<PendingDiff>(1000);
    const t0 = 1_000_000;
    const token = store.put(pending("ucl-2026"), t0);
    expect(store.consume(token, t0 + 999)).not.toBeNull();

    const token2 = store.put(pending("ucl-2026"), t0);
    expect(store.consume(token2, t0 + 1001)).toBeNull();
  });

  it("expired tokens are evicted on consume", () => {
    const store = new TokenStore<PendingDiff>(1000);
    const t0 = 1_000_000;
    const token = store.put(pending("a"), t0);
    expect(store.size()).toBe(1);
    store.consume(token, t0 + 5000);
    expect(store.size()).toBe(0);
  });

  it("gc() sweeps multiple expired entries", () => {
    const store = new TokenStore<PendingDiff>(1000);
    const t0 = 1_000_000;
    store.put(pending("a"), t0);
    store.put(pending("b"), t0);
    store.put(pending("c"), t0 + 5000);
    expect(store.size()).toBe(3);
    const removed = store.gc(t0 + 2000);
    expect(removed).toBe(2);
    expect(store.size()).toBe(1);
  });

  it("works with arbitrary value types (generic)", () => {
    const store = new TokenStore<{ foo: string; n: number }>();
    const token = store.put({ foo: "bar", n: 42 });
    const entry = store.consume(token);
    expect(entry).toEqual({ foo: "bar", n: 42 });
  });
});
