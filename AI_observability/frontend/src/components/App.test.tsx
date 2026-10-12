import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { getMockResponse } from "../api/mock";
import type { DataSource, Dataset, DatasetDetail, DatasetPreview, RemediationPlan } from "../api/contracts";

function renderApp(initialEntry = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("frontend route shell", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the command center shell and handles health API failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderApp();

    expect(screen.getByRole("heading", { name: /platform command center/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(await screen.findByText(/API resource.*could not refresh/i, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("marks a cached provider snapshot stale when the health API later fails", async () => {
    let healthRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      if (path === "/health" && healthRequests++ > 0) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    const { queryClient } = renderApp();
    expect(await screen.findByText("API connected")).toBeInTheDocument();
    await queryClient.invalidateQueries({ queryKey: ["health"] });
    expect(await screen.findByText("API unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Last known provider status · connection stale/)).toBeInTheDocument();
  });

  it("pairs accessible loading status with reduced-motion-aware skeleton placeholders", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderApp();

    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(document.querySelector(".loading-skeleton")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows backend-backed health, product impact, and explicit agent/API gaps", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp();

    expect(await screen.findByRole("heading", { name: "Critical data health" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Line of business" })).toHaveValue("motor");
    expect(await screen.findByText("Claims Analytics")).toBeInTheDocument();
    expect(screen.getByText("Fraud/Risk Scoring")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(screen.getByText("Remediation approval feed unavailable")).toBeInTheDocument();
    expect(screen.getByText("execution states · API gap")).toBeInTheDocument();
    expect(await screen.findByText("DataRCAAgent")).toBeInTheDocument();
    expect(screen.getByText(/Historical trend is not supplied by the API/)).toBeInTheDocument();
  });

  it("shows an empty-state message when the API has no Motor records", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      const body = path === "/health"
        ? getMockResponse(path)
        : path === "/lineage"
          ? { nodes: [], edges: [], line_of_business: "motor", generated_at: "2026-10-09T08:30:00Z" }
          : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp();

    expect(await screen.findByText("No platform records are available for this line of business yet.")).toBeInTheDocument();
  });

  it("shares the line-of-business selection across navigation and data screens", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      let body: unknown = getMockResponse(path);
      if (path === "/sources") {
        const source: DataSource = {
          source_id: "home-feed",
          name: "Home Feed",
          source_type: "transactional",
          line_of_business: "home",
          status: "healthy",
          attributes: { fixture: true },
        };
        body = [...getMockResponse<DataSource[]>(path), source];
      } else if (path === "/datasets") {
        const dataset: Dataset = {
          dataset_id: "silver.home_policies",
          name: "Home Policies",
          layer: "silver",
          source_id: "home-feed",
          line_of_business: "home",
          schema_version: "1.0",
          description: "Home insurance fixture dataset.",
          attributes: { fixture: true },
        };
        body = [...getMockResponse<Dataset[]>(path), dataset];
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp();

    const lineSelector = await screen.findByRole("combobox", { name: "Line of business" });
    expect(lineSelector).toHaveValue("motor");
    await screen.findByRole("option", { name: "Home" });
    fireEvent.change(lineSelector, { target: { value: "home" } });
    expect(lineSelector).toHaveValue("home");
    fireEvent.click(screen.getByRole("link", { name: "Data Sources" }));

    expect(await screen.findByRole("heading", { name: "Home Feed" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Claims" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Dataset Explorer" }));
    expect(await screen.findByRole("button", { name: /Home Policies/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bronze\.claims/i })).not.toBeInTheDocument();
  });

  it("lets the shared selector change context from a line-specific SLA deep link", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      let body: unknown = getMockResponse(path);
      if (path === "/sources") {
        const homeSource: DataSource = {
          source_id: "home-feed",
          name: "Home Feed",
          source_type: "transactional",
          line_of_business: "home",
          status: "healthy",
          attributes: { fixture: true },
        };
        body = [...getMockResponse<DataSource[]>(path), homeSource];
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/sla?line_of_business=motor");

    const selector = await screen.findByRole("combobox", { name: "Line of business" });
    await screen.findByRole("option", { name: "Home" });
    expect(selector).toHaveValue("motor");
    fireEvent.change(selector, { target: { value: "home" } });
    await waitFor(() => expect(selector).toHaveValue("home"));
    fireEvent.click(screen.getByRole("link", { name: "Data Sources" }));
    expect(await screen.findByRole("heading", { name: "Home Feed" })).toBeInTheDocument();
  });

  it("derives shared line-of-business context from a dataset deep link", async () => {
    const homeDataset: Dataset = {
      dataset_id: "silver.home_policies",
      name: "Home Policies",
      layer: "silver",
      source_id: "home-feed",
      line_of_business: "home",
      schema_version: "1.0",
      description: "Home insurance fixture dataset.",
      attributes: { fixture: true },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      let body: unknown = getMockResponse(path);
      if (path === "/datasets") {
        body = [...getMockResponse<Dataset[]>(path), homeDataset];
      } else if (path === "/datasets/silver.home_policies") {
        const detail = getMockResponse<DatasetDetail>("/datasets/silver.claims");
        body = { ...detail, dataset: homeDataset };
      } else if (path === "/datasets/silver.home_policies/preview") {
        const preview = getMockResponse<DatasetPreview>("/datasets/silver.claims/preview?limit=10");
        body = { ...preview, dataset_id: homeDataset.dataset_id };
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/datasets?dataset_id=silver.home_policies");

    await screen.findByRole("combobox", { name: "Line of business" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Line of business" })).toHaveValue("home"));
    expect(screen.getByRole("button", { name: /Home Policies/ })).toBeInTheDocument();
  });

  it("keeps the Agent Center reachable at its short route alias", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/agents");

    expect(await screen.findByRole("heading", { name: "Agentic AI Center" })).toBeInTheDocument();
  });

  it("disables the Motor-only simulator outside the Motor business context", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/simulator?line_of_business=home");

    expect(await screen.findByText(/displayed source fixtures and simulator controls are Motor Insurance only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start All/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Request Claims Quality Failure injection/ })).toBeDisabled();
  });

  it("renders synthetic source cards with evidence-backed live state and filtering", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/sources");

    expect(await screen.findByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Claims" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customer CRM" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bureau" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Telematics" })).toBeInTheDocument();
    expect(screen.getAllByText("Transactional batches")).toHaveLength(3);
    expect(screen.getByText("File landing feed")).toBeInTheDocument();
    expect(screen.getByText("Event stream")).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting for first event")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "View Claims pipeline and lineage" })).toHaveAttribute(
      "href",
      "/lineage?anchor=source.claims",
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Filter data sources" }), { target: { value: "attention" } });
    expect(screen.getByRole("heading", { name: "Claims" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Telematics" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Customer CRM" })).not.toBeInTheDocument();
  });

  it("renders backend quality, freshness, event evidence, and cross-screen links", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/quality");

    expect(await screen.findByRole("heading", { name: "Data Quality & Observability" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Quality check results" })).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("12", { selector: "td" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /silver\.claims/i }).some((link) =>
      link.getAttribute("href") === "/datasets?dataset_id=silver.claims",
    )).toBe(true);
    expect(screen.getAllByRole("link", { name: /Incident · Synthetic claims quality failure/ }).some((link) =>
      link.getAttribute("href")?.startsWith("/incidents?incident_id=fixture-incident-1#event-"),
    )).toBe(true);
    expect(screen.getAllByRole("link", { name: /Lineage/ }).some((link) =>
      link.getAttribute("href") === "/lineage?anchor=silver.claims",
    )).toBe(true);
    expect(screen.getByRole("link", { name: /View SLA & Data Products/ })).toHaveAttribute("href", "/sla");
    expect(screen.getByRole("link", { name: /Review Incident Intelligence/ })).toHaveAttribute("href", "/incidents");
  });

  it("keeps empty and failed quality API states explicit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      if (path === "/quality") return new Response("{}", { status: 503 });
      if (path === "/events" || path === "/sla") {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/quality");

    expect(await screen.findByText(
      /Some observability resources could not be loaded: quality checks/i,
      {},
      { timeout: 5000 },
    )).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable", { selector: ".metric-card strong" })).toHaveLength(3);
    expect(screen.getByText("No freshness SLA records are reported.")).toBeInTheDocument();
    expect(screen.getByText("No observability events have been reported.")).toBeInTheDocument();
    expect(screen.getByText("Quality checks could not be loaded. Check the FastAPI quality endpoint.")).toBeInTheDocument();
  });

  it("renders backend lineage states, highlights incident impact, and opens node details", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/lineage?anchor=source.claims");

    expect(await screen.findByRole("group", { name: "Interactive directed data lineage graph" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /claims, source, healthy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /silver claims, dataset, degraded/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /silver payments, dataset, healthy/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Health legend")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by node type" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Highlight incident impact" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("120%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fit graph" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    const silverClaims = screen.getByRole("button", { name: /silver claims, dataset, degraded/i });
    expect(silverClaims.querySelector("rect")?.getAttribute("stroke")).toBe("#e3b956");
    const silverPayments = screen.getByRole("button", { name: /silver payments, dataset, healthy/i });
    expect(silverPayments.querySelector("rect")?.getAttribute("stroke")).toBe("#55c69e");

    fireEvent.click(screen.getByRole("combobox", { name: "Highlight incident impact" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Highlight incident impact" }), {
      target: { value: "fixture-incident-1" },
    });

    expect(screen.getByText(/Highlighting impact from:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /claims, source, healthy/i }));
    expect(screen.getByRole("complementary", { name: "Claims node details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /upstream · 0/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /downstream · 1/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /highlight downstream/i }));

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by health status" }), { target: { value: "critical" } });
    expect(screen.getByText("No graph nodes match the current filters.")).toBeInTheDocument();
  });

  it("searches and filters datasets, then shows backend detail, lineage, incidents, and safe preview", async () => {
    const requestedPaths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      requestedPaths.push(`${path}${url.search}`);
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/datasets");

    expect(await screen.findByRole("heading", { name: "Dataset Explorer" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /silver\.claims/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by layer" }), { target: { value: "silver" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search datasets" }), { target: { value: "silver.claims" } });
    expect(screen.getAllByRole("button", { name: /silver\.claims/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /silver\.claims/ }));

    expect(await screen.findByRole("heading", { name: "silver.claims" })).toBeInTheDocument();
    expect(screen.getByText("Provider identity")).toBeInTheDocument();
    expect(screen.getByText("Not reported by this API")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: ready")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Status: degraded").length).toBeGreaterThan(0);
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in lineage/i })).toHaveAttribute("href", "/lineage?anchor=silver.claims");
    expect(screen.getByRole("link", { name: /inspect quality signals/i })).toHaveAttribute("href", "/quality?dataset_id=silver.claims");
    expect(await screen.findByRole("link", { name: /synthetic claims quality failure/i })).toHaveAttribute(
      "href",
      "/incidents?incident_id=fixture-incident-1",
    );
    expect(await screen.findByText(/synthetic-silver-claims-001/i)).toBeInTheDocument();
    expect(screen.queryByText(/email|phone|address|customer_name/i)).not.toBeInTheDocument();
    expect(requestedPaths).toContain("/datasets/silver.claims");
    expect(requestedPaths).toContain("/datasets/silver.claims/preview?limit=10");
  });

  it("shows an explicit error when selected dataset details cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      if (path === "/datasets") {
        return new Response(JSON.stringify(getMockResponse(path)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ code: "unavailable", message: "Dataset detail unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/datasets");

    fireEvent.click(await screen.findByRole("button", { name: /risk features/i }));
    expect(await screen.findByText(/dataset details are unavailable for feature\.risk_features/i, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("shows evidence-grounded incident assessment, lineage impact, SLA, and remediation state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/incidents?incident_id=fixture-incident-1");

    expect(await screen.findByRole("heading", { name: "AI Incident Intelligence" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Root-cause assessment" })).toBeInTheDocument();
    expect(screen.getByText("Deterministic confidence")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("Evidence Consistency")).toBeInTheDocument();
    expect(screen.getByText(/not proof of causality/i)).toBeInTheDocument();
    expect(screen.getByText("Affected data products")).toBeInTheDocument();
    expect(screen.getByText("Claims Analytics")).toBeInTheDocument();
    expect(screen.getByText("SLA state")).toBeInTheDocument();
    expect((await screen.findAllByText(/synthetic claims quality failure/i)).length).toBeGreaterThan(0);
    expect(screen.getByText("Root node")).toBeInTheDocument();
    expect(screen.getByText("Not supplied by the RCA contract")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /show lineage/i })).toHaveAttribute("href", "/lineage?anchor=silver.claims");
    expect(screen.getByRole("link", { name: /show evidence/i })).toHaveAttribute("href", "#incident-evidence");
    expect(screen.getByText(/Chronological ordering only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("saves human remediation rejection through the backend approval action", async () => {
    let approvalDecision: boolean | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (init?.method === "PATCH" && path === "/remediation/fixture-remediation-claims-quality/approval") {
        const body = JSON.parse(String(init.body)) as { approved: boolean };
        approvalDecision = body.approved;
        return new Response(JSON.stringify({
          ...getMockResponse<RemediationPlan[]>("/remediation")[0],
          approved: body.approved,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/remediation") {
        const plans = getMockResponse<RemediationPlan[]>("/remediation").map((plan) => ({
          ...plan,
          approved: approvalDecision,
        }));
        return new Response(JSON.stringify(plans), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/incidents?incident_id=fixture-incident-1");

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect(await screen.findByLabelText("Status: rejected")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/remediation/fixture-remediation-claims-quality/approval"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("generates a new remediation plan without executing it", async () => {
    let storedPlans: RemediationPlan[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (path === "/remediation" && init?.method === "POST") {
        const plan = JSON.parse(String(init.body)) as RemediationPlan;
        storedPlans = [plan];
        return new Response(JSON.stringify(plan), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/remediation") {
        return new Response(JSON.stringify(storedPlans.filter((plan) =>
          !url.searchParams.get("incident_id") || plan.incident_id === url.searchParams.get("incident_id"),
        )), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/incidents?incident_id=fixture-incident-1");

    fireEvent.click(await screen.findByRole("button", { name: /claims schema differs from baseline/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate Remediation" }));
    expect(await screen.findByText(/Review the evidence and validation for bronze\.claims/)).toBeInTheDocument();
    expect(screen.getByText(/Human approval required: Yes/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/remediation$/),
      expect.objectContaining({ method: "POST" }),
    );
    expect(storedPlans[0].approved).toBeNull();
    expect(storedPlans[0].mode).toBe("simulate");
  });

  it("shows incident-linked agent workflow stages and honest execution telemetry gaps", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/agent-center?incident_id=fixture-incident-1");

    expect(await screen.findByRole("heading", { name: "Agentic AI Center" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "AgentOrchestrator" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Select incident workflow" })).toHaveValue("fixture-incident-1");
    for (const name of [
      "DataAnomalyAgent",
      "DataRCAAgent",
      "LineageImpactAgent",
      "InsuranceContextAgent",
      "SLAAgent",
      "RemediationAgent",
      "VerificationAgent",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Recent executions")).toBeInTheDocument();
    expect(screen.getByText("No execution records reported")).toBeInTheDocument();
    expect(screen.getAllByText(/Provider: not reported/)).toHaveLength(7);
    expect(screen.getAllByText(/Start\/end\/duration: not reported/)).toHaveLength(7);
    expect(screen.getByText(/Waiting for human approval before verification/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence & findings" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /finding fixture-finding-claims-quality/i })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /finding fixture-finding-claims-quality/i }).every((link) =>
      link.getAttribute("href") === "/agent-center?incident_id=fixture-incident-1#finding-fixture-finding-claims-quality",
    )).toBe(true);
    expect(screen.getAllByRole("link", { name: /00000000-0000-4000-8000-000000000002/i }).some((link) =>
      link.getAttribute("href") === "/incidents?incident_id=fixture-incident-1#event-00000000-0000-4000-8000-000000000002",
    )).toBe(true);
    expect(screen.getByText(/execution-state API not available/i)).toBeInTheDocument();
  });

  it("shows an explicit empty state in the Agent Center", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      const body = path === "/incidents" ? [] : getMockResponse(path);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/agent-center");
    expect(await screen.findByText("No backend incidents are available to anchor an agent workflow.")).toBeInTheDocument();
  });

  it("shows lineage-backed products, dependencies, freshness evidence, and linked incidents", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/sla");

    expect(await screen.findByRole("heading", { name: "SLA & Data Products" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Claims Analytics/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Customer 360/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Feature Store/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fraud\/Risk Scoring/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Claims Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Required datasets & features" })).toBeInTheDocument();
    expect(screen.getAllByText("silver.claims").length).toBeGreaterThan(0);
    expect(screen.getAllByText("silver.policies").length).toBeGreaterThan(0);
    expect(screen.getByText(/Product-level deadline: not supplied by the API/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Freshness SLA records" })).toBeInTheDocument();
    expect(screen.getByText(/Observed age exceeds target by 30m/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Linked active incidents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Synthetic claims quality failure/i })).toHaveAttribute(
      "href",
      "/incidents?incident_id=fixture-incident-1",
    );

    fireEvent.click(screen.getByRole("button", { name: /Fraud\/Risk Scoring/ }));
    expect(screen.getByRole("heading", { name: "Fraud/Risk Scoring" })).toBeInTheDocument();
    expect(await screen.findByText(/feature\.risk_features/)).toBeInTheDocument();
    expect(await screen.findByText(/feature\.driving_features/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View product lineage" })).toHaveAttribute(
      "href",
      "/lineage?anchor=ai.fraud_risk_scoring",
    );
  });

  it("shows clear empty and loading/error states for product data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      const body = path === "/lineage"
        ? { nodes: [], edges: [], line_of_business: "motor", generated_at: "2026-10-09T08:30:00Z" }
        : getMockResponse(path);
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    renderApp("/sla");
    expect(await screen.findByText(/No data products are registered in the backend lineage graph/)).toBeInTheDocument();
  });

  it("surfaces failed SLA API requests without fabricating freshness status", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
      if (path === "/sla") return new Response("{}", { status: 503 });
      return new Response(JSON.stringify(getMockResponse(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/sla");

    expect(await screen.findByText(
      /Some product, dataset, or SLA data could not be loaded/,
      {},
      { timeout: 4000 },
    )).toBeInTheDocument();
  });

  it("runs only documented simulator cycles and reports scenario acknowledgement without mutating observability views", async () => {
    const postedRequests: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (init?.method === "POST") {
        postedRequests.push({ path, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({
          cycles: [{
            cycle_number: 1,
            run_id: "motor-demo-test",
            source_counts: { claims: 12, policies: 12, customers: 12, payments: 12, bureau: 12, telematics: 12 },
            silver_counts: {},
            gold_counts: {},
            rejected_counts: {},
            event_count: 4,
          }],
          event_count: 4,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/simulator") {
        return new Response(JSON.stringify({ enabled: true, last_cycles: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/simulator");

    expect(await screen.findByRole("heading", { name: "Demo Control Center" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Telematics" })).toBeInTheDocument();
    expect(screen.getByText("SYNTHETIC DEMO DATA ONLY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset demo unavailable" })).toBeDisabled();
    expect(screen.getAllByText(/WAITING/).length).toBeGreaterThanOrEqual(6);

    const injection = screen.getByRole("button", { name: "Request Claims Quality Failure injection" });
    fireEvent.click(injection);
    const confirmation = await screen.findByRole("alertdialog", { name: "Confirm Claims Quality Failure" });
    expect(confirmation).toBeInTheDocument();
    expect(confirmation.contains(document.activeElement)).toBe(true);
    expect(postedRequests).toHaveLength(0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(postedRequests).toHaveLength(0);
    fireEvent.click(injection);
    fireEvent.click(screen.getByRole("button", { name: "Confirm scenario injection" }));
    expect(await screen.findByText(/Scenario injection requested/)).toBeInTheDocument();
    expect(postedRequests).toEqual([{
      path: "/simulator/cycles",
      body: { cycles: 1, failure_scenarios: ["CLAIMS_QUALITY_FAILURE"] },
    }]);
    expect(screen.getAllByText(/WAITING/).length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByText(/no continuously running worker is reported/i)).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: /Start All/ }));
    expect(await screen.findByText(/Synthetic cycle request completed/)).toBeInTheDocument();
    expect(postedRequests[1]).toEqual({
      path: "/simulator/cycles",
      body: { cycles: 1, failure_scenarios: [] },
    });
  });

  it("provides a persistent Ask AI panel with deterministic backend evidence answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp();
    const openAskAi = screen.getByRole("button", { name: /ask platform ai/i });
    openAskAi.focus();
    openAskAi.click();

    expect(await screen.findByRole("dialog", { name: /ask the platform/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close AI panel" })).toHaveFocus();
    expect(screen.getByText("DETERMINISTIC", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Gemini: not invoked/)).toBeInTheDocument();
    expect(screen.getByText(/backend has no conversational endpoint yet/i)).toBeInTheDocument();
    const slaQuestion = screen.getByRole("button", { name: "Are any SLAs at risk?" });
    await waitFor(() => expect(slaQuestion).toBeEnabled(), { timeout: 5000 });
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("link", { name: /Open full investigation workspace/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close AI panel" })).toHaveFocus();
    fireEvent.click(slaQuestion);
    expect(await screen.findByText(/dataset freshness SLA record/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dataset · silver\.payments/i })).toHaveAttribute(
      "href",
      "/datasets?dataset_id=silver.payments",
    );
    expect(screen.getAllByRole("link", { name: "SLA & Data Products" }).some((link) =>
      link.getAttribute("href") === "/sla",
    )).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /ask the platform/i })).not.toBeInTheDocument();
    expect(openAskAi).toHaveFocus();
  });

  it("answers incident-cause questions with persisted RCA or evidence-only fallback and links", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/ask-ai");

    expect(await screen.findByRole("heading", { name: "Ask Your Data Platform AI", level: 1 })).toBeInTheDocument();
    const claimsQuestion = screen.getByRole("button", { name: "What caused the Claims incident?" });
    await waitFor(() => expect(claimsQuestion).toBeEnabled());
    fireEvent.click(claimsQuestion);
    expect(await screen.findByText(/Persisted RCA summary:/)).toBeInTheDocument();
    expect(screen.getAllByText(/DETERMINISTIC/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Incident · Synthetic claims quality failure/i })).toHaveAttribute(
      "href",
      "/incidents?incident_id=fixture-incident-1",
    );
    expect(screen.getByRole("link", { name: /Evidence · quality failure/i })).toHaveAttribute(
      "href",
      expect.stringContaining("#event-"),
    );
  });

  it("does not treat unavailable SLA records as an empty or healthy result in Ask AI", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (path === "/sla") return new Response("{}", { status: 503 });
      return new Response(JSON.stringify(getMockResponse(`${path}${url.search}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    renderApp("/ask-ai");

    const slaQuestion = await screen.findByRole("button", { name: "Are any SLAs at risk?" });
    await waitFor(() => expect(slaQuestion).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(slaQuestion);
    expect(await screen.findByText(/Freshness SLA data could not be loaded/)).toBeInTheDocument();
  });
});
