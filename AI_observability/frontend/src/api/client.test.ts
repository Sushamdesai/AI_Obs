import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "./client";

describe("API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes FastAPI errors without losing correlation IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "http_404",
            message: "Unknown dataset",
            correlation_id: "corr-demo",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(apiGet("/datasets/missing")).rejects.toMatchObject({
      status: 404,
      code: "http_404",
      correlationId: "corr-demo",
      message: "Unknown dataset",
    });
  });

  it("uses the configured FastAPI base URL and passes abort signals", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "healthy" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ status: string }>("/health", controller.signal)).resolves.toEqual({
      status: "healthy",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/health$/),
      expect.objectContaining({ method: "GET", signal: controller.signal }),
    );
  });
});
