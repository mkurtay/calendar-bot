// Env-driven configuration. Centralized so server.ts and any future
// entry points (HTTP transport, scripts, tests) call one function to
// get a typed, validated Config — no scattered process.env reads.

export interface Config {
  github: {
    owner: string;
    repo: string;
    branch: string;
    token: string;
  };
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface ConfigSource {
  get(key: string): string | undefined;
}

export const processEnvSource: ConfigSource = {
  get: (key) => process.env[key],
};

export function loadConfig(source: ConfigSource = processEnvSource): Config {
  const token = source.get("GITHUB_TOKEN");
  if (!token) {
    throw new ConfigError("GITHUB_TOKEN env var required. See .env.example for details.");
  }
  return {
    github: {
      owner: source.get("GITHUB_OWNER") ?? "mkurtay",
      repo: source.get("GITHUB_REPO") ?? "kurtays-calendar",
      branch: source.get("GITHUB_BRANCH") ?? "main",
      token,
    },
  };
}
