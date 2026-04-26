// Short-lived token store for the review-then-commit flow (Q1).
// `update_calendar` stashes a diff under a fresh token and returns it
// to the LLM; `apply_calendar_update` consumes the token to commit.
// Tokens are one-shot — consume() removes the entry — and expire after
// `ttlMs` to avoid stale diffs lingering in memory.

import { randomUUID } from "node:crypto";
import type { CalendarDiff, PendingDiff } from "./types.js";

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class TokenStore {
  private readonly store = new Map<string, PendingDiff>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  put(
    calendarId: string,
    diff: CalendarDiff,
    now: number = Date.now(),
  ): string {
    const token = randomUUID();
    this.store.set(token, {
      calendarId,
      diff,
      expiresAt: now + this.ttlMs,
    });
    return token;
  }

  // Returns the entry if present and unexpired, then removes it
  // (one-shot semantics). Returns null on missing or expired tokens.
  consume(token: string, now: number = Date.now()): PendingDiff | null {
    const entry = this.store.get(token);
    if (!entry) return null;
    if (now > entry.expiresAt) {
      this.store.delete(token);
      return null;
    }
    this.store.delete(token);
    return entry;
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
