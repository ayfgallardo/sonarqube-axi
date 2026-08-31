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

const { hotspotCommand, issueCommand } =
  await import("../../src/commands/triage.js");
const { AxiError } = await import("../../src/errors.js");

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

const PTOK = "fake-personal";

describe("hotspotCommand review", () => {
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

  it("reviews a hotspot as safe when the personal token can change status", async () => {
    sonarGetMock.mockResolvedValueOnce({
      key: "AY000000000000000000009",
      status: "TO_REVIEW",
      canChangeStatus: true,
    });
    sonarPostMock.mockResolvedValueOnce(undefined);

    const output = await hotspotCommand(
      ["review", "AY000000000000000000009", "--safe", "-m", "no risk here"],
      CTX,
    );

    expect(resolvePersonalTokenMock).toHaveBeenCalledWith("sonar-example");
    expect(sonarGetMock).toHaveBeenCalledWith(
      "hotspots/show",
      { hotspot: "AY000000000000000000009" },
      expect.objectContaining({ token: PTOK }),
    );
    expect(sonarPostMock).toHaveBeenCalledWith(
      "hotspots/change_status",
      {
        hotspot: "AY000000000000000000009",
        status: "REVIEWED",
        resolution: "SAFE",
        comment: "no risk here",
      },
      expect.objectContaining({ token: PTOK }),
    );
    expect(output).toContain("SAFE");
  });

  it("refuses without exactly one resolution flag", async () => {
    await expect(
      hotspotCommand(["review", "AY0001"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      hotspotCommand(["review", "AY0001", "--safe", "--fixed"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(sonarGetMock).not.toHaveBeenCalled();
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-REVIEWED hotspot succeeds without a POST", async () => {
    sonarGetMock.mockResolvedValueOnce({
      key: "AY0001",
      status: "REVIEWED",
      resolution: "FIXED",
      canChangeStatus: true,
    });

    const output = await hotspotCommand(["review", "AY0001", "--safe"], CTX);

    expect(output).toContain("déjà revu");
    expect(output).toContain("FIXED");
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("refuses the mutation when the personal token lacks the right, with no POST", async () => {
    sonarGetMock.mockResolvedValueOnce({
      key: "AY0001",
      status: "TO_REVIEW",
      canChangeStatus: false,
    });

    await expect(
      hotspotCommand(["review", "AY0001", "--fixed"], CTX),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("surfaces the Sonar error message on a failed change_status call", async () => {
    sonarGetMock.mockResolvedValueOnce({
      key: "AY0001",
      status: "TO_REVIEW",
      canChangeStatus: true,
    });
    sonarPostMock.mockRejectedValueOnce(
      new AxiError("Hotspot not found", "NOT_FOUND"),
    );

    await expect(
      hotspotCommand(["review", "AY0001", "--ack"], CTX),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Hotspot not found",
    });
  });
});

describe("issueCommand transition", () => {
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

  it("refuses without a mandatory comment, before any network call", async () => {
    await expect(
      issueCommand(["transition", "AY0002", "falsepositive"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(resolvePersonalTokenMock).not.toHaveBeenCalled();
    expect(sonarGetMock).not.toHaveBeenCalled();
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("checks rights via additionalFields=actions,transitions before mutating", async () => {
    sonarGetMock.mockResolvedValueOnce({
      issues: [
        {
          key: "AY0002",
          issueStatus: "OPEN",
          transitions: ["falsepositive", "accept", "confirm"],
        },
      ],
    });
    sonarPostMock.mockResolvedValue(undefined);

    await issueCommand(
      ["transition", "AY0002", "falsepositive", "-m", "not a real bug"],
      CTX,
    );

    expect(sonarGetMock).toHaveBeenCalledWith(
      "issues/search",
      { issues: "AY0002", additionalFields: "actions,transitions" },
      expect.objectContaining({ token: PTOK }),
    );
  });

  it("posts the comment then the transition, in order", async () => {
    sonarGetMock.mockResolvedValueOnce({
      issues: [
        {
          key: "AY0002",
          issueStatus: "OPEN",
          transitions: ["falsepositive", "accept", "confirm"],
        },
      ],
    });
    sonarPostMock.mockResolvedValue(undefined);

    await issueCommand(
      ["transition", "AY0002", "falsepositive", "-m", "not a real bug"],
      CTX,
    );

    expect(sonarPostMock).toHaveBeenNthCalledWith(
      1,
      "issues/add_comment",
      { issue: "AY0002", text: "not a real bug" },
      expect.objectContaining({ token: PTOK }),
    );
    expect(sonarPostMock).toHaveBeenNthCalledWith(
      2,
      "issues/do_transition",
      { issue: "AY0002", transition: "falsepositive" },
      expect.objectContaining({ token: PTOK }),
    );
  });

  it("is idempotent: an already-accepted issue succeeds without any POST", async () => {
    sonarGetMock.mockResolvedValueOnce({
      issues: [
        {
          key: "AY0002",
          issueStatus: "ACCEPTED",
          transitions: [],
        },
      ],
    });

    const output = await issueCommand(
      ["transition", "AY0002", "accept", "-m", "still fine"],
      CTX,
    );

    expect(output).toContain("déjà");
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("refuses when the transition is unavailable and not already applied", async () => {
    sonarGetMock.mockResolvedValueOnce({
      issues: [
        {
          key: "AY0002",
          issueStatus: "OPEN",
          transitions: ["confirm"],
        },
      ],
    });

    await expect(
      issueCommand(
        ["transition", "AY0002", "falsepositive", "-m", "motif"],
        CTX,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sonarPostMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown issue key with no matching issue", async () => {
    sonarGetMock.mockResolvedValueOnce({ issues: [] });

    await expect(
      issueCommand(["transition", "AY9999", "accept", "-m", "motif"], CTX),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sonarPostMock).not.toHaveBeenCalled();
  });
});
