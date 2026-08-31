import { describe, expect, it } from "vitest";
import { getSuggestions } from "../src/suggestions.js";

describe("getSuggestions", () => {
  it("suggests issues and hotspots when the gate is red", () => {
    const lines = getSuggestions({ domain: "qg", gateStatus: "ERROR" });
    expect(lines.join(" ")).toContain("sonarqube-axi issues");
    expect(lines.join(" ")).toContain("sonarqube-axi hotspots");
  });

  it("suggests nothing extra when the gate is green", () => {
    expect(getSuggestions({ domain: "qg", gateStatus: "OK" })).toEqual([]);
  });

  it("suggests hotspot review when hotspots remain", () => {
    const lines = getSuggestions({ domain: "hotspots", remaining: 3 });
    expect(lines.join(" ")).toContain("hotspot review");
  });

  it("suggests nothing extra when no hotspots remain", () => {
    expect(getSuggestions({ domain: "hotspots", remaining: 0 })).toEqual([]);
  });
});
