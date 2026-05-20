import { Octokit } from "@octokit/rest";

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface FileEntry {
  name: string;
  path: string;
}

export class GitHub {
  private octokit: Octokit;

  constructor(private config: GitHubConfig) {
    this.octokit = new Octokit({ auth: config.token });
  }

  async listFiles(dir: string): Promise<FileEntry[]> {
    const res = await this.octokit.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: this.config.branch,
      path: dir,
    });
    if (!Array.isArray(res.data)) {
      throw new Error(`Path is not a directory: ${dir}`);
    }
    return res.data
      .filter((entry) => entry.type === "file")
      .map((entry) => ({ name: entry.name, path: entry.path }));
  }

  async getFile(path: string): Promise<{ content: string; sha: string }> {
    const res = await this.octokit.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: this.config.branch,
      path,
    });
    if (Array.isArray(res.data) || res.data.type !== "file") {
      throw new Error(`Path is not a file: ${path}`);
    }
    const content = Buffer.from(res.data.content, "base64").toString("utf8");
    return { content, sha: res.data.sha };
  }

  async putFile(args: {
    path: string;
    content: string;
    sha: string;
    message: string;
  }): Promise<{ sha: string; commitUrl: string }> {
    const res = await this.octokit.repos.createOrUpdateFileContents({
      owner: this.config.owner,
      repo: this.config.repo,
      branch: this.config.branch,
      path: args.path,
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      sha: args.sha,
    });
    const newSha = res.data.content?.sha;
    const commitUrl = res.data.commit?.html_url ?? "";
    if (!newSha) {
      throw new Error("GitHub putFile returned no SHA");
    }
    return { sha: newSha, commitUrl };
  }

  // Creates a new file at `path`. Throws a clear error if the file
  // already exists (GitHub returns 422 when sha is omitted on a path
  // that already has content).
  async createFile(args: {
    path: string;
    content: string;
    message: string;
  }): Promise<{ sha: string; commitUrl: string }> {
    try {
      const res = await this.octokit.repos.createOrUpdateFileContents({
        owner: this.config.owner,
        repo: this.config.repo,
        branch: this.config.branch,
        path: args.path,
        message: args.message,
        content: Buffer.from(args.content, "utf8").toString("base64"),
      });
      const newSha = res.data.content?.sha;
      const commitUrl = res.data.commit?.html_url ?? "";
      if (!newSha) {
        throw new Error("GitHub createFile returned no SHA");
      }
      return { sha: newSha, commitUrl };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status: number }).status === 422
      ) {
        throw new Error(`File already exists at ${args.path}`);
      }
      throw err;
    }
  }

  /**
   * List recent commits that touched `path`, newest first. Used by the
   * revert flow to find the most-recent change to a calendar JSON.
   */
  async listCommitsForPath(
    path: string,
    limit: number = 10,
  ): Promise<
    Array<{
      sha: string;
      message: string;
      authorDate: string | undefined;
      authorName: string | undefined;
    }>
  > {
    const res = await this.octokit.repos.listCommits({
      owner: this.config.owner,
      repo: this.config.repo,
      sha: this.config.branch,
      path,
      per_page: limit,
    });
    return res.data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      authorDate: c.commit.author?.date,
      authorName: c.commit.author?.name ?? undefined,
    }));
  }

  /**
   * Read a file at a specific commit ref (not necessarily HEAD). The
   * revert flow uses this to fetch the file as it was BEFORE the
   * most recent change, then writes that content back as a new commit
   * (content-equivalent revert without a git merge).
   */
  async getFileAtRef(
    path: string,
    ref: string,
  ): Promise<{ content: string }> {
    const res = await this.octokit.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      ref,
      path,
    });
    if (Array.isArray(res.data) || res.data.type !== "file") {
      throw new Error(`Path at ${ref} is not a file: ${path}`);
    }
    const content = Buffer.from(res.data.content, "base64").toString("utf8");
    return { content };
  }
}
