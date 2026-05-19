import type { GitHub } from "./github.js";

export interface Calendar {
  id: string;
  html_file?: string;
  name: string;
  category: string;
  ics: {
    prodid: string;
    calscale: string;
    method: string;
    default_event_status?: string;
  };
  competition?: { name: string; season: string };
  events: CalendarEvent[];
  [key: string]: unknown;
}

export interface CalendarEvent {
  uid: string;
  emoji?: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  description_lines?: string[];
  status: "scheduled" | "completed" | "cancelled";
  result: unknown;
  [key: string]: unknown;
}

export interface CalendarSummary {
  id: string;
  name: string;
  category: string;
  event_count: number;
  upcoming_count: number;
}

export class CalendarStore {
  constructor(private gh: GitHub) {}

  async listCalendars(): Promise<CalendarSummary[]> {
    const files = await this.gh.listFiles("data");
    const jsons = files.filter((f) => f.name.endsWith(".json"));
    const now = new Date();
    return Promise.all(
      jsons.map(async ({ path }) => {
        const { content } = await this.gh.getFile(path);
        const cal = JSON.parse(content) as Calendar;
        const upcoming = cal.events.filter((e) => new Date(e.end) >= now).length;
        return {
          id: cal.id,
          name: cal.name,
          category: cal.category,
          event_count: cal.events.length,
          upcoming_count: upcoming,
        };
      })
    );
  }

  async getCalendar(id: string): Promise<{ calendar: Calendar; sha: string; path: string }> {
    const path = `data/${id}.json`;
    const { content, sha } = await this.gh.getFile(path);
    return { calendar: JSON.parse(content) as Calendar, sha, path };
  }

  async saveCalendar(calendar: Calendar, sha: string, message: string): Promise<{ sha: string; commitUrl: string }> {
    const path = `data/${calendar.id}.json`;
    const content = JSON.stringify(calendar, null, 2) + "\n";
    return this.gh.putFile({ path, content, sha, message });
  }

  // Creates a new calendar at data/<id>.json. Rejects if a calendar
  // with that id already exists (the underlying GitHub API surfaces
  // a 422; createFile rethrows as a clear error message).
  async create(
    calendar: Calendar,
    message: string,
  ): Promise<{ sha: string; commitUrl: string; path: string }> {
    const path = `data/${calendar.id}.json`;
    const content = JSON.stringify(calendar, null, 2) + "\n";
    const { sha, commitUrl } = await this.gh.createFile({
      path,
      content,
      message,
    });
    return { sha, commitUrl, path };
  }
}
