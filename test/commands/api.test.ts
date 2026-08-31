import { beforeEach, describe, expect, it, vi } from "vitest";

const sonarGetMock = vi.fn();
const sonarPostMock = vi.fn();
const loadConfigMock = vi.fn();
const resolvePersonalTokenMock = vi.fn();

vi.mock("../../src/sonar.js", () => ({
  sonarGet: sonarGetMock,
  sonarPost: sonarPostMock,
}));
vi.mock("../../src/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("../../src/auth.js", () => ({
  resolvePersonalToken: resolvePersonalTokenMock,
}));

const { apiCommand } = await import("../../src/commands/api.js");

const PTOK = "fake-personal";

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

describe("apiCommand", () => {
  beforeEach(() => {
    sonarGetMock.mockReset();
    sonarPostMock.mockReset();
    loadConfigMock.mockReset();
    resolvePersonalTokenMock.mockReset();
    loadConfigMock.mockReturnValue({
      host: CTX.host,
      insecure: false,
      keychainService: "sonar-example",
    });
    resolvePersonalTokenMock.mockResolvedValue(PTOK);
  });

  it("defaults to a GET with the project token", async () => {
    sonarGetMock.mockResolvedValueOnce({ total: 0, issues: [] });

    const output = await apiCommand(
      ["issues/search", "componentKeys=example_project_00000000"],
      CTX,
    );

    expect(sonarGetMock).toHaveBeenCalledWith(
      "issues/search",
      { componentKeys: "example_project_00000000" },
      expect.objectContaining({ token: CTX.token }),
    );
    expect(sonarPostMock).not.toHaveBeenCalled();
    expect(output).toContain('"total": 0');
    expect(resolvePersonalTokenMock).not.toHaveBeenCalled();
  });

  it("uses the personal token with --personal", async () => {
    sonarGetMock.mockResolvedValueOnce({ total: 0, issues: [] });

    await apiCommand(["issues/search", "--personal"], CTX);

    expect(resolvePersonalTokenMock).toHaveBeenCalledWith("sonar-example");
    expect(sonarGetMock).toHaveBeenCalledWith(
      "issues/search",
      {},
      expect.objectContaining({ token: PTOK }),
    );
  });

  it("refuses a mutation without --allow-mutation, firing no request", async () => {
    await expect(
      apiCommand(
        ["issues/add_comment", "issue=AY0002", "text=hi", "--method", "POST"],
        CTX,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(sonarGetMock).not.toHaveBeenCalled();
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("allows a POST once --allow-mutation is given", async () => {
    sonarPostMock.mockResolvedValueOnce(undefined);

    await apiCommand(
      [
        "issues/add_comment",
        "issue=AY0002",
        "text=hi",
        "--method",
        "POST",
        "--allow-mutation",
      ],
      CTX,
    );

    expect(sonarPostMock).toHaveBeenCalledWith(
      "issues/add_comment",
      { issue: "AY0002", text: "hi" },
      expect.objectContaining({ token: CTX.token }),
    );
    expect(sonarGetMock).not.toHaveBeenCalled();
  });

  it("rejects a method other than GET or POST, even with --allow-mutation", async () => {
    await expect(
      apiCommand(
        [
          "issues/search",
          "issue=AY0002",
          "--method",
          "DELETE",
          "--allow-mutation",
        ],
        CTX,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(sonarGetMock).not.toHaveBeenCalled();
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("requires a path", async () => {
    await expect(apiCommand([], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
