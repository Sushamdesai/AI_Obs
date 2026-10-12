import { describe, expect, it } from "vitest";
import { getMockResponse } from "./mock";
import type { DashboardSnapshot } from "./contracts";

describe("explicit development fixtures", () => {
  it("provides backend-contract-shaped overview data with valid graph endpoints", () => {
    const health = getMockResponse<DashboardSnapshot["health"]>("/health");
    const sources = getMockResponse<DashboardSnapshot["sources"]>("/sources");
    const datasets = getMockResponse<DashboardSnapshot["datasets"]>("/datasets");
    const events = getMockResponse<DashboardSnapshot["events"]>("/events");
    const lineage = getMockResponse<DashboardSnapshot["lineage"]>("/lineage");

    expect(health.providers).toEqual({
      data_platform: "ready",
      observability: "ready",
      llm: "ready",
    });
    expect(sources).toHaveLength(6);
    expect(datasets.every((dataset) => dataset.line_of_business === "motor")).toBe(true);
    expect(events.every((event) => event.event_id.length === 36)).toBe(true);
    const nodes = new Set(lineage.nodes.map((node) => node.node_id));
    expect(
      lineage.edges.every(
        (edge) => nodes.has(edge.source_node_id) && nodes.has(edge.target_node_id),
      ),
    ).toBe(true);
  });

  it("does not silently fabricate fixtures for unmapped endpoints", () => {
    expect(() => getMockResponse("/chat")).toThrow(/does not provide a response/i);
  });
});
