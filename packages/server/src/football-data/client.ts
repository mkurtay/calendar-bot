// Thin client for football-data.org v4. Reads the API token from
// $FOOTBALL_DATA_TOKEN at construction time so a missing config
// surfaces as a clear error from the tool layer (not a 401 from
// the API).
//
// Rate limit on the free tier is 10 requests/minute. Bursting beyond
// that returns 429. We don't bake in retry/backoff here because
// each agent turn typically makes 1-3 calls — well below the cap.

export class FootballDataClient {
  constructor(private readonly token: string) {}

  async fetch<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`https://api.football-data.org/v4${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const response = await fetch(url.toString(), {
      headers: { "X-Auth-Token": this.token },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `football-data.org GET ${path} → ${response.status} ${response.statusText}: ${body}`,
      );
    }
    return response.json() as Promise<T>;
  }
}

export function makeFootballDataClient(): FootballDataClient {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN env var required for football-data tools. " +
        "Free key at https://www.football-data.org/client/register",
    );
  }
  return new FootballDataClient(token);
}
