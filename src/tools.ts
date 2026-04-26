import { randomUUID } from "node:crypto";
import type {
  CalendarStore,
  CalendarEvent,
} from "./calendar-store.js";

export interface ListEventsParams {
  calendar_id: string;
  from?: string;
  to?: string;
}

export interface AddEventParams {
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  uid?: string;
  emoji?: string;
  location?: string;
  description_lines?: string[];
  typed_block?: Record<string, unknown>;
}

export interface UpdateEventParams {
  calendar_id: string;
  uid: string;
  patch: Record<string, unknown>;
}

export interface RemoveEventParams {
  calendar_id: string;
  uid: string;
}

export interface SetResultParams {
  calendar_id: string;
  uid: string;
  result: Record<string, unknown> | null;
  mark_completed?: boolean;
}

export async function listCalendars(store: CalendarStore) {
  return { calendars: await store.listCalendars() };
}

export async function listEvents(store: CalendarStore, p: ListEventsParams) {
  const { calendar } = await store.getCalendar(p.calendar_id);
  let events = calendar.events;
  if (p.from) {
    const from = p.from;
    events = events.filter((e) => e.start >= from);
  }
  if (p.to) {
    const to = p.to;
    events = events.filter((e) => e.end <= to);
  }
  return { calendar_id: calendar.id, count: events.length, events };
}

export async function addEvent(store: CalendarStore, p: AddEventParams) {
  const { calendar, sha } = await store.getCalendar(p.calendar_id);
  const uid = p.uid ?? `${calendar.id}-${randomUUID().slice(0, 8)}`;
  if (calendar.events.some((e) => e.uid === uid)) {
    throw new Error(`Event with UID ${uid} already exists in ${calendar.id}`);
  }
  const event: CalendarEvent = {
    uid,
    title: p.title,
    start: p.start,
    end: p.end,
    status: "scheduled",
    result: null,
    ...(p.emoji && { emoji: p.emoji }),
    ...(p.location && { location: p.location }),
    ...(p.description_lines && { description_lines: p.description_lines }),
    ...(p.typed_block ?? {}),
  };
  calendar.events.push(event);
  const { sha: newSha, commitUrl } = await store.saveCalendar(
    calendar,
    sha,
    `Add event: ${event.title}`,
  );
  return { added: event, commit_sha: newSha, commit_url: commitUrl };
}

export async function updateEvent(
  store: CalendarStore,
  p: UpdateEventParams,
) {
  const { calendar, sha } = await store.getCalendar(p.calendar_id);
  const idx = calendar.events.findIndex((e) => e.uid === p.uid);
  if (idx === -1) {
    throw new Error(`No event with UID ${p.uid} in ${p.calendar_id}`);
  }
  const before = calendar.events[idx]!;
  const after: CalendarEvent = { ...before, ...p.patch };
  calendar.events[idx] = after;
  const { sha: newSha, commitUrl } = await store.saveCalendar(
    calendar,
    sha,
    `Update event ${p.uid}: ${after.title}`,
  );
  return { before, after, commit_sha: newSha, commit_url: commitUrl };
}

export async function removeEvent(
  store: CalendarStore,
  p: RemoveEventParams,
) {
  const { calendar, sha } = await store.getCalendar(p.calendar_id);
  const idx = calendar.events.findIndex((e) => e.uid === p.uid);
  if (idx === -1) {
    throw new Error(`No event with UID ${p.uid} in ${p.calendar_id}`);
  }
  const removed = calendar.events.splice(idx, 1)[0]!;
  const { sha: newSha, commitUrl } = await store.saveCalendar(
    calendar,
    sha,
    `Remove event ${p.uid}: ${removed.title}`,
  );
  return { removed, commit_sha: newSha, commit_url: commitUrl };
}

export async function setResult(store: CalendarStore, p: SetResultParams) {
  const { calendar, sha } = await store.getCalendar(p.calendar_id);
  const idx = calendar.events.findIndex((e) => e.uid === p.uid);
  if (idx === -1) {
    throw new Error(`No event with UID ${p.uid} in ${p.calendar_id}`);
  }
  const before = calendar.events[idx]!;
  const after: CalendarEvent = {
    ...before,
    result: p.result,
    ...(p.mark_completed !== false ? { status: "completed" as const } : {}),
  };
  calendar.events[idx] = after;
  const { sha: newSha, commitUrl } = await store.saveCalendar(
    calendar,
    sha,
    `Set result for ${p.uid}: ${after.title}`,
  );
  return { before, after, commit_sha: newSha, commit_url: commitUrl };
}
