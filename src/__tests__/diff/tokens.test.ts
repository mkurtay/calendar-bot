import { TokenStore } from "../../diff/tokens.js";
import type { CalendarDiff } from "../../diff/types.js";

function emptyDiff(): CalendarDiff {
  return { entries: [], resolved: [], isNoop: true };
}

describe("TokenStore", () => {
  it("returns a token from put() that consume() resolves to the same diff", () => {
    const store = new TokenStore();
    const d = emptyDiff();
    const token = store.put("ucl-2026", d);
    const entry = store.consume(token);
    expect(entry).not.toBeNull();
    expect(entry?.calendarId).toBe("ucl-2026");
    expect(entry?.diff).toBe(d);
  });

  it("issues distinct tokens for separate puts", () => {
    const store = new TokenStore();
    const t1 = store.put("a", emptyDiff());
    const t2 = store.put("b", emptyDiff());
    expect(t1).not.toBe(t2);
  });

  it("consume() is one-shot (second call returns null)", () => {
    const store = new TokenStore();
    const token = store.put("ucl-2026", emptyDiff());
    expect(store.consume(token)).not.toBeNull();
    expect(store.consume(token)).toBeNull();
  });

  it("consume() returns null for unknown token", () => {
    const store = new TokenStore();
    expect(store.consume("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("expires entries after the configured TTL", () => {
    const store = new TokenStore(1000);
    const t0 = 1_000_000;
    const token = store.put("ucl-2026", emptyDiff(), t0);
    expect(store.consume(token, t0 + 999)).not.toBeNull();

    const token2 = store.put("ucl-2026", emptyDiff(), t0);
    expect(store.consume(token2, t0 + 1001)).toBeNull();
  });

  it("expired tokens are evicted on consume", () => {
    const store = new TokenStore(1000);
    const t0 = 1_000_000;
    const token = store.put("a", emptyDiff(), t0);
    expect(store.size()).toBe(1);
    store.consume(token, t0 + 5000);
    expect(store.size()).toBe(0);
  });

  it("gc() sweeps multiple expired entries", () => {
    const store = new TokenStore(1000);
    const t0 = 1_000_000;
    store.put("a", emptyDiff(), t0);
    store.put("b", emptyDiff(), t0);
    store.put("c", emptyDiff(), t0 + 5000);
    expect(store.size()).toBe(3);
    const removed = store.gc(t0 + 2000);
    expect(removed).toBe(2);
    expect(store.size()).toBe(1);
  });
});
