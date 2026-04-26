// Calendar diff engine. Pairs current and incoming events by uid,
// applies the merge policy, and produces a `CalendarDiff` describing
// adds, removals, updates, and preservations.

import type { Event } from "../models/types.js";
import { describeChanges, mergeEvent } from "./policy.js";
import type { CalendarDiff, DiffEntry } from "./types.js";

export function diff(current: Event[], incoming: Event[]): CalendarDiff {
  const currentByUid = new Map(current.map((e) => [e.uid, e]));
  const incomingByUid = new Map(incoming.map((e) => [e.uid, e]));

  const entries: DiffEntry[] = [];
  const resolved: Event[] = [];

  // Walk current first so the resolved array preserves existing event
  // order; new events are appended at the end.
  for (const cur of current) {
    if (cur.local_only) {
      // Q2-C: sticky regardless of source presence.
      entries.push({ kind: "preserved-local-only", event: cur });
      resolved.push(cur);
      continue;
    }

    const inc = incomingByUid.get(cur.uid);
    if (!inc) {
      // In current, missing from incoming → removed.
      entries.push({ kind: "removed", event: cur });
      continue;
    }

    const merged = mergeEvent(cur, inc);
    const changes = describeChanges(cur, merged);

    // Audit "preserved-result" regardless of whether other fields
    // changed: when local had a result and source proposed a different
    // one, we kept local — record it for the review summary even if
    // nothing else changed (Q2-B in action).
    const localHadResult = cur.result !== undefined && cur.result !== null;
    const sourceProposedDifferent =
      inc.result !== undefined &&
      inc.result !== null &&
      JSON.stringify(inc.result) !== JSON.stringify(cur.result);
    if (localHadResult && sourceProposedDifferent) {
      entries.push({
        kind: "preserved-result",
        event: merged,
        sourceResult: inc.result,
      });
    }

    if (changes.length === 0) {
      resolved.push(cur);
      continue;
    }

    entries.push({ kind: "updated", before: cur, after: merged, changes });
    resolved.push(merged);
  }

  // Walk incoming for adds — events not seen in current.
  for (const inc of incoming) {
    if (currentByUid.has(inc.uid)) continue;
    entries.push({ kind: "added", event: inc });
    resolved.push(inc);
  }

  const hasMutating = entries.some(
    (e) => e.kind === "added" || e.kind === "removed" || e.kind === "updated",
  );

  return { entries, resolved, isNoop: !hasMutating };
}

// Compact text summary for the review-then-commit flow. The MCP tool
// returns this alongside the structured diff so the LLM can show the
// user something readable in chat.
export function summarizeDiff(d: CalendarDiff): string {
  const counts = {
    added: 0,
    removed: 0,
    updated: 0,
    preservedLocalOnly: 0,
    preservedResult: 0,
  };
  for (const entry of d.entries) {
    if (entry.kind === "added") counts.added++;
    else if (entry.kind === "removed") counts.removed++;
    else if (entry.kind === "updated") counts.updated++;
    else if (entry.kind === "preserved-local-only") counts.preservedLocalOnly++;
    else if (entry.kind === "preserved-result") counts.preservedResult++;
  }

  if (d.isNoop) {
    const local = counts.preservedLocalOnly
      ? ` (${counts.preservedLocalOnly} local-only preserved)`
      : "";
    return `No changes${local}.`;
  }

  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.updated) parts.push(`${counts.updated} updated`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  if (counts.preservedLocalOnly) {
    parts.push(`${counts.preservedLocalOnly} local-only preserved`);
  }
  if (counts.preservedResult) {
    parts.push(`${counts.preservedResult} local result preserved`);
  }
  return parts.join(", ") + ".";
}
