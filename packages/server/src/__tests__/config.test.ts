import { ConfigError, ConfigSource, loadConfig } from "../config.js";

function source(env: Record<string, string | undefined>): ConfigSource {
  return { get: (key) => env[key] };
}

describe("loadConfig", () => {
  it("rejects when GH_TOKEN is missing", () => {
    expect(() => loadConfig(source({}))).toThrow(ConfigError);
    expect(() => loadConfig(source({}))).toThrow(/GH_TOKEN/);
  });

  it("rejects when GH_TOKEN is empty string", () => {
    expect(() => loadConfig(source({ GH_TOKEN: "" }))).toThrow(ConfigError);
  });

  it("returns defaults when only GH_TOKEN is set", () => {
    const config = loadConfig(source({ GH_TOKEN: "ghp_test" }));
    expect(config.github).toEqual({
      owner: "mkurtay",
      repo: "cal",
      branch: "main",
      token: "ghp_test",
    });
  });

  it("overrides each default from env", () => {
    const config = loadConfig(
      source({
        GH_TOKEN: "ghp_test",
        GITHUB_OWNER: "another-user",
        GITHUB_REPO: "another-repo",
        GITHUB_BRANCH: "develop",
      }),
    );
    expect(config.github).toEqual({
      owner: "another-user",
      repo: "another-repo",
      branch: "develop",
      token: "ghp_test",
    });
  });
});
