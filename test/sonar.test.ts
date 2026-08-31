import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAgent {
  constructor(readonly options: unknown) {}
}

vi.mock("undici", () => ({ Agent: FakeAgent }));

const { sonarGet, sonarPost } = await import("../src/sonar.js");
const { AxiError } = await import("../src/errors.js");

const HOST = "https://sonar.example.com";
const TOKEN = "fake-token";

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(index = 0): [string, RequestInit] {
  return fetchMock.mock.calls[index] as [string, RequestInit];
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

describe("sonar transport", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs <host>/api/<path> with params in the query string and a Bearer header", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { total: 3 }));

    const result = await sonarGet<{ total: number }>(
      "issues/search",
      { componentKeys: "example_project_00000000", ps: 10, resolved: false },
      { token: TOKEN, host: HOST, insecure: false },
    );

    expect(result).toEqual({ total: 3 });
    const [url, init] = lastCall();
    expect(url).toBe(
      `${HOST}/api/issues/search?componentKeys=example_project_00000000&ps=10&resolved=false`,
    );
    expect(init.method).toBe("GET");
    expect(headerOf(init, "Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("drops undefined params", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await sonarGet(
      "qualitygates/project_status",
      { projectKey: "example_project_00000000", pullRequest: undefined },
      { token: TOKEN, host: HOST, insecure: false },
    );

    expect(lastCall()[0]).toBe(
      `${HOST}/api/qualitygates/project_status?projectKey=example_project_00000000`,
    );
  });

  it("POSTs params as application/x-www-form-urlencoded", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await sonarPost(
      "hotspots/change_status",
      { hotspot: "AY000000", status: "REVIEWED", resolution: "SAFE" },
      { token: TOKEN, host: HOST, insecure: false },
    );

    const [url, init] = lastCall();
    expect(url).toBe(`${HOST}/api/hotspots/change_status`);
    expect(init.method).toBe("POST");
    expect(headerOf(init, "Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(init.body).toBe("hotspot=AY000000&status=REVIEWED&resolution=SAFE");
  });

  it("returns undefined-safe output for an empty 204 body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      sonarPost(
        "hotspots/change_status",
        { hotspot: "AY000000" },
        {
          token: TOKEN,
          host: HOST,
          insecure: false,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("falls back to HTTP Basic when Bearer is rejected with 401", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { errors: [{ msg: "Unauthorized" }] }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { total: 1 }));

    const result = await sonarGet<{ total: number }>(
      "issues/search",
      {},
      { token: TOKEN, host: HOST, insecure: false },
    );

    expect(result).toEqual({ total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headerOf(lastCall(0)[1], "Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headerOf(lastCall(1)[1], "Authorization")).toBe(
      `Basic ${Buffer.from(`${TOKEN}:`).toString("base64")}`,
    );
  });

  it("gives up after the Basic fallback also returns 401", async () => {
    // A fresh Response per call: the transport drains the rejected body before
    // retrying, so a shared instance would be unusable on the second read.
    fetchMock.mockImplementation(async () =>
      jsonResponse(401, { errors: [{ msg: "Unauthorized" }] }),
    );

    let thrown: unknown;
    try {
      await sonarGet(
        "issues/search",
        {},
        { token: TOKEN, host: HOST, insecure: false },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AxiError);
    expect((thrown as InstanceType<typeof AxiError>).code).toBe(
      "AUTH_REQUIRED",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces errors[0].msg on a 404", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { errors: [{ msg: "Component key not found" }] }),
    );

    await expect(
      sonarGet(
        "measures/component",
        {},
        { token: TOKEN, host: HOST, insecure: false },
      ),
    ).rejects.toMatchObject({
      message: "Component key not found",
      code: "NOT_FOUND",
    });
  });

  it("does not retry a 403 with Basic", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { errors: [{ msg: "Insufficient privileges" }] }),
    );

    await expect(
      sonarGet(
        "hotspots/search",
        {},
        { token: TOKEN, host: HOST, insecure: false },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes a per-request dispatcher disabling TLS verification when insecure", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    const before = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];

    await sonarGet(
      "system/status",
      {},
      { token: TOKEN, host: HOST, insecure: true },
    );

    const dispatcher = (lastCall()[1] as { dispatcher?: FakeAgent }).dispatcher;
    expect(dispatcher).toBeInstanceOf(FakeAgent);
    expect(dispatcher?.options).toEqual({
      connect: { rejectUnauthorized: false },
    });
    expect(process.env["NODE_TLS_REJECT_UNAUTHORIZED"]).toBe(before);
  });

  it("sends no dispatcher when TLS verification stays on", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await sonarGet(
      "system/status",
      {},
      { token: TOKEN, host: HOST, insecure: false },
    );

    expect(lastCall()[1]).not.toHaveProperty("dispatcher");
  });

  it("maps a network failure to a NETWORK_ERROR mentioning the host", async () => {
    const cause = Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause }),
    );

    await expect(
      sonarGet(
        "system/status",
        {},
        { token: TOKEN, host: HOST, insecure: false },
      ),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("never leaks the token into the thrown error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { errors: [{ msg: "boom" }] }),
    );

    const error = await sonarGet(
      "system/status",
      {},
      { token: TOKEN, host: HOST, insecure: false },
    ).catch((e: Error) => e);

    expect(
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ).not.toContain(TOKEN);
  });
});
