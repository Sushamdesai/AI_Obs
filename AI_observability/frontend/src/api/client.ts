import { apiConfig } from "./config";
import type { ApiError } from "./contracts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;

  constructor(
    message: string,
    options: { status: number; code: string; correlationId?: string | null },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.correlationId = options.correlationId ?? null;
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (apiConfig.mockMode) {
    const { getMockResponse } = await import("./mock");
    return getMockResponse<T>(path);
  }

  const response = await fetch(`${apiConfig.baseUrl}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      body?.message ?? `The API request failed with status ${response.status}.`,
      {
        status: response.status,
        code: body?.code ?? "http_error",
        correlationId:
          body?.correlation_id ?? response.headers.get("X-Correlation-ID"),
      },
    );
  }
  return (await response.json()) as T;
}

export async function apiSend<T>(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<T> {
  if (apiConfig.mockMode) {
    const { sendMockRequest } = await import("./mock");
    return sendMockRequest<T>(method, path, body);
  }

  const response = await fetch(`${apiConfig.baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      errorBody?.message ?? errorBody?.detail ?? `The API request failed with status ${response.status}.`,
      {
        status: response.status,
        code: errorBody?.code ?? "http_error",
        correlationId:
          errorBody?.correlation_id ?? response.headers.get("X-Correlation-ID"),
      },
    );
  }
  return (await response.json()) as T;
}
