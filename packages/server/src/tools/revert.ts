// Two-phase revert flow for calendar JSON. `propose_revert` looks at
// the commit history of `data/<id>.json`, returns the most-recent
// change(s) and a one-shot token; `apply_revert` consumes the token
// and writes the prior content back as a new commit.
//
// Why two phases: matches update_calendar / apply_calendar_update so
// the bot follows the same "narrate diff, ask user, then commit"
// pattern. The user sees what's about to be reverted before
// anything writes to GitHub.

import type { CalendarStore } from "../calendar-store.js";
import type { GitHub } from "../github.js";
import { TokenStore } from "../diff/tokens.js";

interface RevertPayload {
  calendarId: string;
  path: string;
  /** Commit being reverted (the bad one). */
  badSha: string;
  /** Commit whose content we'll restore (parent of badSha, or further
   *  back if user requested commits_back > 1). */
  goodSha: string;
  /** Subject line of the bad commit; surfaced in the new commit msg. */
  badSubject: string;
}

const tokens = new TokenStore<RevertPayload>();

export interface ProposeRevertParams {
  calendar_id: string;
  /** How many commits to roll back. Default 1 (revert just the latest
   *  change to the calendar). Cap at 10 to bound display + sanity. */
  commits_back?: number;
}

export const PROPOSE_REVERT_TOOL = {
  name: "propose_revert",
  description:
    "Prepare a revert of the last N commit(s) on a calendar's JSON " +
    "file. Returns a one-shot token and a summary of what will be " +
    "reverted (commit messages, target SHA, total commits affected). " +
    "Does NOT commit — call apply_revert with the token. Always show " +
    "the user the proposed revert summary BEFORE applying so they " +
    "can confirm.\n\n" +
    "commits_back defaults to 1. The flow assumes commits_back == 1 " +
    "for typical 'undo my last change' asks; pass a larger N for " +
    "deeper rollbacks. Capped at 10. Tokens expire after 10 minutes.",
  inputSchema: {
    type: "object",
    properties: {
      calendar_id: { type: "string" },
      commits_back: {
        type: "number",
        description: "How many commits to revert. Default 1, max 10.",
      },
    },
    required: ["calendar_id"],
    additionalProperties: false,
  },
} as const;

export async function proposeRevert(
  store: CalendarStore,
  gh: GitHub,
  p: ProposeRevertParams,
) {
  // Resolve the calendar's path even if we don't read its content,
  // so we can validate calendar_id and locate the file.
  const { path } = await store.getCalendar(p.calendar_id);
  const n = Math.max(1, Math.min(10, p.commits_back ?? 1));

  // Need n+1 commits: the n we'll revert + the one we'll restore TO.
  const commits = await gh.listCommitsForPath(path, n + 1);
  if (commits.length < 2) {
    throw new Error(
      `Not enough history on ${path} to revert ${n} commit(s) ` +
        `(found ${commits.length} total).`,
    );
  }

  // The last commit in our slice is the target (good) SHA.
  const goodCommit = commits[n];
  const badCommit = commits[0];
  if (!goodCommit || !badCommit) {
    throw new Error("Internal: commit slice unexpectedly empty.");
  }

  const summary = {
    calendar_id: p.calendar_id,
    path,
    commits_to_revert: commits.slice(0, n).map((c) => ({
      sha: c.sha.slice(0, 7),
      subject: c.message.split("\n", 1)[0],
      author: c.authorName ?? null,
      date: c.authorDate ?? null,
    })),
    will_restore_to: {
      sha: goodCommit.sha.slice(0, 7),
      subject: goodCommit.message.split("\n", 1)[0],
      date: goodCommit.authorDate ?? null,
    },
  };

  const token = tokens.put({
    calendarId: p.calendar_id,
    path,
    badSha: badCommit.sha,
    goodSha: goodCommit.sha,
    badSubject: badCommit.message.split("\n", 1)[0] ?? "",
  });

  return { token, summary };
}

export interface ApplyRevertParams {
  token: string;
}

export const APPLY_REVERT_TOOL = {
  name: "apply_revert",
  description:
    "Commit the revert prepared by propose_revert. Writes the file " +
    "contents from the target (good) SHA back to the branch as a new " +
    "commit named \"Revert <sha>: <subject>\". Tokens are one-shot and " +
    "expire 10 minutes after issue.\n\n" +
    "Guidance: always show the user the propose_revert summary BEFORE " +
    "calling this. If they want to revert more, call propose_revert " +
    "again with a larger commits_back.",
  inputSchema: {
    type: "object",
    properties: {
      token: { type: "string" },
    },
    required: ["token"],
    additionalProperties: false,
  },
} as const;

export async function applyRevert(gh: GitHub, p: ApplyRevertParams) {
  const payload = tokens.consume(p.token);
  if (!payload) {
    throw new Error(
      "Revert token expired or already used. Call propose_revert again to get a fresh token.",
    );
  }

  // Fetch the file as it was at the good SHA (the state we want to
  // restore). Then fetch the current file (at HEAD) only to get its
  // blob SHA — putFile needs it as the conflict-detection handle.
  const [oldContent, currentFile] = await Promise.all([
    gh.getFileAtRef(payload.path, payload.goodSha),
    gh.getFile(payload.path),
  ]);

  const message = `Revert ${payload.badSha.slice(0, 7)}: ${payload.badSubject}`;
  const result = await gh.putFile({
    path: payload.path,
    content: oldContent.content,
    sha: currentFile.sha,
    message,
  });

  return {
    calendar_id: payload.calendarId,
    reverted_commit: payload.badSha.slice(0, 7),
    restored_to: payload.goodSha.slice(0, 7),
    new_commit_sha: result.sha,
    commit_url: result.commitUrl,
    message,
  };
}
