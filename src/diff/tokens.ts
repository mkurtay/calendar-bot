// Short-lived generic token store for review-then-commit flows (Q1).
// `update_calendar` stashes a value under a fresh token; the matching
// `apply_*` tool consumes the token to commit. Tokens are one-shot
// (consume() removes the entry) and expire after `ttlMs` to avoid
// stale state lingering in memory. Generic over the value type so
// each consumer can stash whatever shape it needs.

import { randomUUID } from "node:crypto";

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TokenStore<T> {
  private readonly store = new Map<string, Entry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  put(value: T, now: number = Date.now()): string {
    const token = randomUUID();
    this.store.set(token, {
      value,
      expiresAt: now + this.ttlMs,
    });
    return token;
  }

  // Returns the value if present and unexpired, then removes it
  // (one-shot semantics). Returns null on missing or expired tokens.
  consume(token: string, now: number = Date.now()): T | null {
    const entry = this.store.get(token);
    if (!entry) return null;
    if (now > entry.expiresAt) {
      this.store.delete(token);
      return null;
    }
    this.store.delete(token);
    return entry.value;
  }

  // Best-effort sweep of expired entries. Safe to call periodically
  // or never — consume() also drops expired entries on the way past.
  gc(now: number = Date.now()): number {
    let removed = 0;
    for (const [token, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(token);
        removed++;
      }
    }
    return removed;
  }

  // For tests/observability only.
  size(): number {
    return this.store.size;
  }
}
