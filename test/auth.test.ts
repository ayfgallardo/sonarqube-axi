import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { basicAuthHeader, bearerAuthHeader, resolvePersonalToken } =
  await import("../src/auth.js");
const { AxiError } = await import("../src/errors.js");

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

function keychainReturns(stdout: string): void {
  execFileMock.mockImplementation(
    (_file: string, _args: string[], callback: ExecCallback) => {
      callback(null, stdout, "");
    },
  );
}

function keychainFails(): void {
  execFileMock.mockImplementation(
    (_file: string, _args: string[], callback: ExecCallback) => {
      callback(new Error("The specified item could not be found"), "", "");
    },
  );
}

describe("auth headers", () => {
  it("builds the primary Bearer header", () => {
    expect(bearerAuthHeader("fake-token")).toBe("Bearer fake-token");
  });

  it("builds the Basic fallback with the token as login and an empty password", () => {
    expect(basicAuthHeader("fake-token")).toBe(
      `Basic ${Buffer.from("fake-token:").toString("base64")}`,
    );
  });
});

describe("resolvePersonalToken", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("reads the token from the Keychain with the configured service", async () => {
    keychainReturns("fake-personal-token\n");

    await expect(resolvePersonalToken("sonar-example")).resolves.toBe(
      "fake-personal-token",
    );

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe("security");
    expect(args).toEqual([
      "find-generic-password",
      "-s",
      "sonar-example",
      "-w",
    ]);
  });

  it("defaults to the sonarqube-axi service", async () => {
    keychainReturns("fake-personal-token\n");

    await resolvePersonalToken();

    expect(execFileMock.mock.calls[0][1]).toContain("sonarqube-axi");
  });

  it("guides towards `security add-generic-password` when absent", async () => {
    keychainFails();

    let thrown: unknown;
    try {
      await resolvePersonalToken("sonar-example");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AxiError);
    const error = thrown as InstanceType<typeof AxiError>;
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.suggestions.join(" ")).toContain("add-generic-password");
    expect(error.suggestions.join(" ")).toContain("sonar-example");
  });
});
