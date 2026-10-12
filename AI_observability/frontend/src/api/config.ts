const refreshInterval = Number(import.meta.env.VITE_REFRESH_INTERVAL_MS ?? 15_000);

export const apiConfig = {
  baseUrl: (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, ""),
  refreshIntervalMs:
    Number.isFinite(refreshInterval) && refreshInterval >= 5_000
      ? refreshInterval
      : 15_000,
  mockMode: import.meta.env.VITE_DEMO_MOCKS === "true",
};
