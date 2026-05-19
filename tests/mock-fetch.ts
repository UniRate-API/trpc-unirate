// Tiny mock fetch factory shared across the test suite. Builds a
// `typeof fetch` implementation backed by a per-path response map and
// records every request URL for assertions.

import { vi } from "vitest";

export type MockResponse =
  | { status?: number; body: unknown }
  | { status?: number; rawText: string }
  | { error: Error };

export interface MockFetchHandle {
  fetch: typeof fetch;
  calls: string[];
  mock: ReturnType<typeof vi.fn>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const raw = (text: string, status = 200): Response =>
  new Response(text, {
    status,
    headers: { "Content-Type": "text/html" },
  });

export const makeFetch = (
  routes: Partial<Record<string, MockResponse>>,
): MockFetchHandle => {
  const calls: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const pathname = new URL(url).pathname;
    const route = routes[pathname];
    if (!route) {
      return new Response(JSON.stringify({ error: "no route" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if ("error" in route) throw route.error;
    if ("rawText" in route) return raw(route.rawText, route.status ?? 200);
    return json(route.body, route.status ?? 200);
  });
  return { fetch: mock as unknown as typeof fetch, calls, mock };
};
