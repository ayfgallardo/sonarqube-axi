import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const resolvePersonalTokenMock = vi.fn();

vi.mock("../src/auth.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/auth.js")>("../src/auth.js");
  return { ...actual, resolvePersonalToken: resolvePersonalTokenMock };
});

vi.mock("../src/mr.js", () => ({
  resolveMode: () =>
    Promise.resolve({
      mode: { kind: "branch", branch: "main" },
      strippedArgs: [],
    }),
}));

vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    host: "https://sonar.example.com",
    insecure: false,
    keychainService: "sonar-example",
  }),
}));

const { flushGain, readGainLog, startGain } = await import("../src/gain.js");
const { hotspotsCommand } = await import("../src/commands/hotspots.js");

const HOTSPOTS = readFileSync(
  fileURLToPath(new URL("./fixtures/hotspots-search.json", import.meta.url)),
  "utf-8",
);

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

const fetchMock = vi.fn();

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("gain accounting across an auth retry", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "sonar-axi-gain-retry-"));
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("LOCALAPPDATA", "");
    vi.stubEnv("AXI_GAIN", "");
    fetchMock.mockReset();
    resolvePersonalTokenMock.mockReset();
    resolvePersonalTokenMock.mockResolvedValue("fake-personal-credential");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(home.value, { recursive: true, force: true });
  });

  it("counts only the response the fallback actually served on a 403 retry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(403, JSON.stringify({ errors: [{ msg: "Forbidden" }] })),
      )
      .mockResolvedValueOnce(jsonResponse(200, HOTSPOTS));
    startGain();
    await hotspotsCommand([], CTX);
    await flushGain("hotspots");

    fetchMock.mockResolvedValueOnce(jsonResponse(200, HOTSPOTS));
    startGain();
    await hotspotsCommand([], CTX);
    await flushGain("hotspots");

    const [afterRetry, straightThrough] = readGainLog();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(afterRetry.raw).toBe(straightThrough.raw);
  });

  it("still counts an error body that no retry follows", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, JSON.stringify({ errors: [{ msg: "Not found" }] })),
    );
    startGain();
    await expect(hotspotsCommand([], CTX)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await flushGain("hotspots");

    expect(readGainLog()[0].raw).toBeGreaterThan(0);
  });
});
