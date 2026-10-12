import { describe, expect, it } from "vitest";
import type { LineageGraph, LineageNode } from "../api/contracts";
import { getConnectedNodeIds, getIncidentNodeIds, getLineageHealthColor, getLineageNodeKind, layoutLineageGraph, lineageHealthColors } from "./graph";

const node = (node_id: string, node_type: LineageNode["node_type"] = "dataset", health: LineageNode["health"] = "healthy"): LineageNode => ({
  node_id,
  node_type,
  label: node_id,
  line_of_business: "motor",
  health,
  metadata: {},
});

const graph: LineageGraph = {
  nodes: [
    node("source.claims", "source"),
    node("ingestion.claims", "ingestion"),
    node("quality.claims", "quality_check", "degraded"),
    node("silver.claims", "dataset", "degraded"),
    node("gold.claims_analytics", "data_product", "degraded"),
    node("silver.payments"),
    node("gold.customer_360", "data_product", "healthy"),
    node("ai.fraud_risk_scoring", "ai_product", "healthy"),
  ],
  edges: [
    { source_node_id: "source.claims", target_node_id: "ingestion.claims", relationship: "feeds", metadata: {} },
    { source_node_id: "ingestion.claims", target_node_id: "quality.claims", relationship: "validates", metadata: {} },
    { source_node_id: "quality.claims", target_node_id: "silver.claims", relationship: "validates", metadata: {} },
    { source_node_id: "silver.claims", target_node_id: "gold.claims_analytics", relationship: "contributes_to", metadata: {} },
    { source_node_id: "silver.payments", target_node_id: "gold.customer_360", relationship: "contributes_to", metadata: {} },
    { source_node_id: "gold.customer_360", target_node_id: "ai.fraud_risk_scoring", relationship: "feeds", metadata: {} },
  ],
  line_of_business: "motor",
  generated_at: "2026-10-09T08:30:00Z",
};

describe("lineage graph mappings", () => {
  it("maps each contract node type to a readable category", () => {
    expect(getLineageNodeKind("source")).toBe("Source");
    expect(getLineageNodeKind("quality_check")).toBe("Quality check");
    expect(getLineageNodeKind("transformation")).toBe("Transformation");
    expect(getLineageNodeKind("feature")).toBe("Feature");
    expect(getLineageNodeKind("data_product")).toBe("Data product");
    expect(getLineageNodeKind("ai_product")).toBe("AI product");
  });

  it("uses a distinct status color for every backend health state", () => {
    const colors = Object.keys(lineageHealthColors).map((health) => getLineageHealthColor(health as keyof typeof lineageHealthColors));
    expect(colors).toHaveLength(5);
    expect(new Set(colors).size).toBe(5);
  });

  it("lays out graph nodes left-to-right from source to downstream products", () => {
    const layout = layoutLineageGraph(graph);
    expect(layout.positions.get("source.claims")!.x).toBeLessThan(layout.positions.get("ingestion.claims")!.x);
    expect(layout.positions.get("ingestion.claims")!.x).toBeLessThan(layout.positions.get("quality.claims")!.x);
    expect(layout.positions.get("quality.claims")!.x).toBeLessThan(layout.positions.get("silver.claims")!.x);
    expect(layout.positions.get("silver.claims")!.x).toBeLessThan(layout.positions.get("gold.claims_analytics")!.x);
    expect(layout.positions.get("silver.payments")!.x).toBeLessThan(layout.positions.get("gold.customer_360")!.x);
    expect(layout.width).toBeGreaterThan(layout.nodeWidth);
  });

  it("keeps unrelated products out of a source's downstream path", () => {
    const impacted = getConnectedNodeIds("source.claims", graph.edges, "downstream");
    expect([...impacted]).toEqual([
      "source.claims",
      "ingestion.claims",
      "quality.claims",
      "silver.claims",
      "gold.claims_analytics",
    ]);
    expect(impacted.has("gold.customer_360")).toBe(false);
    expect(graph.nodes.find((node) => node.node_id === "gold.customer_360")?.health).toBe("healthy");
  });

  it("marks active incident nodes from correlated IDs and event references", () => {
    const incidentsByNode = getIncidentNodeIds(graph, [{
      correlated_node_ids: ["source.claims"],
      evidence: [{ source_id: "claims", dataset_id: "silver.claims" }],
    }]);
    expect(incidentsByNode.get("source.claims")).toBe(1);
    expect(incidentsByNode.get("silver.claims")).toBe(1);
    expect(incidentsByNode.has("silver.payments")).toBe(false);
  });
});
