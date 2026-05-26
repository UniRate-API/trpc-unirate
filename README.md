# trpc-unirate

[![npm](https://img.shields.io/npm/v/trpc-unirate.svg)](https://www.npmjs.com/package/trpc-unirate)
[![ci](https://github.com/UniRate-API/trpc-unirate/actions/workflows/ci.yml/badge.svg)](https://github.com/UniRate-API/trpc-unirate/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Drop-in [tRPC](https://trpc.io) v11 router for the [UniRate](https://unirateapi.com) currency-exchange API. One import, one factory call, seven Zod-validated procedures — `convert`, `rate`, `rates`, `historical`, `timeSeries`, `currencies`, `vat`.

UniRate offers **free real-time exchange rates** for 170+ currencies plus VAT data; historical rates and time-series are Pro-tier endpoints.

## Install

```bash
npm install trpc-unirate @trpc/server zod
```

`@trpc/server` and `zod` are peer dependencies — bring your existing versions. Native `fetch` is required (Node ≥ 18.17).

## Quick start

```ts
import { initTRPC } from "@trpc/server";
import { createUniRateRouter } from "trpc-unirate";

const t = initTRPC.create();

export const appRouter = t.router({
  unirate: createUniRateRouter({ apiKey: process.env.UNIRATE_API_KEY! }),
});

export type AppRouter = typeof appRouter;
```

On the client:

```ts
const eur = await trpc.unirate.convert.query({ from: "USD", to: "EUR", amount: 100 });
//    ^? number

const rates = await trpc.unirate.rates.query({ base: "USD" });
//    ^? Record<string, number>
```

## Procedures

All procedures are queries (`useQuery` on the React client).

| Procedure    | Input (Zod-validated)                                                                | Output                                       |
|--------------|--------------------------------------------------------------------------------------|----------------------------------------------|
| `convert`    | `{ from, to, amount? = 1 }`                                                          | `number`                                     |
| `rate`       | `{ from? = "USD", to? }`                                                             | `number` (when `to` set) \| `Record<string, number>` |
| `rates`      | `{ base? = "USD" }`                                                                  | `Record<string, number>`                     |
| `historical` | `{ date: "YYYY-MM-DD", from? = "USD", to?, amount? = 1 }` (Pro)                      | `number` \| `Record<string, number>`         |
| `timeSeries` | `{ startDate, endDate, base? = "USD", amount? = 1, currencies?: string[] }` (Pro)    | `Record<date, Record<currency, number>>`     |
| `currencies` | _none_                                                                                | `string[]` (e.g. `["USD","EUR",...]`)        |
| `vat`        | `{ country? }`                                                                       | `{ total_countries, ... }` or `{ country, vat_data }` |

Currency codes are normalized to uppercase before being sent to the API; Zod enforces 3-letter codes (2-letter for `country`).

## Error mapping

UniRate API errors are mapped to standard `TRPCError` codes, so your client-side `onError` handlers see familiar shapes:

| HTTP | UniRate error class    | `TRPCError.code`         |
|------|------------------------|--------------------------|
| 400  | `InvalidRequestError`  | `BAD_REQUEST`            |
| 401  | `AuthenticationError`  | `UNAUTHORIZED`           |
| 403  | `ProRequiredError`     | `FORBIDDEN`              |
| 404  | `InvalidCurrencyError` | `NOT_FOUND`              |
| 429  | `RateLimitError`       | `TOO_MANY_REQUESTS`      |
| other / network | `UniRateError` | `INTERNAL_SERVER_ERROR`  |

The underlying error is preserved on `cause`.

## Options

```ts
createUniRateRouter({
  apiKey: process.env.UNIRATE_API_KEY!,
  // Optional:
  baseUrl: "https://api.unirateapi.com",  // override for self-hosting / tests
  timeoutMs: 30_000,                       // per-request timeout
  fetch: globalThis.fetch,                 // inject a custom fetch (proxies, MSW, etc.)
  userAgent: "myapp/1.0",                  // overrides "unirate-trpc/x.y.z"
});
```

For tests, you can pass a pre-built client instead of an API key:

```ts
import { UniRateClient, createUniRateRouter } from "trpc-unirate";

const client = new UniRateClient({ apiKey: "test", fetch: mockFetch });
const router = createUniRateRouter({ client });
const caller = router.createCaller({});

expect(await caller.convert({ from: "USD", to: "EUR", amount: 100 })).toBe(92.5);
```

## Why a separate router?

`createUniRateRouter()` returns a fully-built tRPC v11 router. Nest it under any key in your own router via the object form (`t.router({ unirate: ... })`). The router uses its own `initTRPC.create()` internally, which means:

- ✅ No coupling to your context, transformer, or middleware.
- ✅ Zero changes to your existing tRPC setup.
- ✅ Procedures still appear in your generated client types.

If you need shared context (auth, request-scoped caching, etc.) on the UniRate procedures, build them directly with your own `t.procedure` using the exported `UniRateClient` — the schemas live in `uniRateInputSchemas` for re-use.

## Standalone server example

A minimal runnable example lives in [`examples/server.ts`](examples/server.ts). Start it with:

```bash
UNIRATE_API_KEY=your-key npx tsx examples/server.ts
```

## Related

- [`unirate-api`](https://www.npmjs.com/package/unirate-api) — the official Node.js client (used internally as reference; this package re-implements the HTTP surface with zero runtime deps).
- [`@unirate/mcp`](https://www.npmjs.com/package/@unirate/mcp) — Model Context Protocol server for UniRate (use UniRate from Claude Desktop, Cline, etc.).
- [`@unirate/astro`](https://www.npmjs.com/package/@unirate/astro), [`@unirate/eleventy`](https://www.npmjs.com/package/@unirate/eleventy) — build-time SSG integrations.

<!-- unirate-ecosystem-footer:start -->
## Other UniRate clients

UniRate ships official client libraries and framework integrations across the
ecosystem. The repos below are all maintained under the
[UniRate-API](https://github.com/UniRate-API) org.

- **Languages:** [Python](https://github.com/UniRate-API/unirate-api-python) · [Node.js / TypeScript](https://github.com/UniRate-API/unirate-api-nodejs) · [Go](https://github.com/UniRate-API/unirate-api-go) · [Rust](https://github.com/UniRate-API/unirate-api-rust) · [Java](https://github.com/UniRate-API/unirate-api-java) · [Ruby](https://github.com/UniRate-API/unirate-api-ruby) · [PHP](https://github.com/UniRate-API/unirate-api-php) · [.NET](https://github.com/UniRate-API/unirate-api-dotnet) · [Swift](https://github.com/UniRate-API/unirate-api-swift)
- **Web frameworks:** [NestJS](https://github.com/UniRate-API/nestjs-unirate) · [Django / Wagtail](https://github.com/UniRate-API/wagtail-unirate) · [FastAPI](https://github.com/UniRate-API/fastapi-unirate) · [Flask](https://github.com/UniRate-API/flask-unirate) · [React](https://github.com/UniRate-API/react-unirate) · [tRPC](https://github.com/UniRate-API/trpc-unirate)
- **Static-site generators:** [Astro](https://github.com/UniRate-API/astro-unirate) · [Eleventy](https://github.com/UniRate-API/eleventy-unirate) · [Hugo](https://github.com/UniRate-API/hugo-unirate)
- **Data / orchestration:** [Airflow](https://github.com/UniRate-API/airflow-provider-unirate) · [dbt](https://github.com/UniRate-API/dbt-unirate) · [LangChain](https://github.com/UniRate-API/langchain-unirate)
- **Workflow / no-code:** [n8n](https://github.com/UniRate-API/n8n-nodes-unirate) · [Google Sheets](https://github.com/UniRate-API/unirate-sheets) · [MCP server](https://github.com/UniRate-API/unirate-mcp)
- **Editors / tools:** [VS Code](https://github.com/UniRate-API/vscode-unirate) · [Obsidian](https://github.com/UniRate-API/obsidian-currency)
- **Specialty bridges:** [NodaMoney (.NET)](https://github.com/UniRate-API/UniRateApi.NodaMoney)

Get a free API key at [unirateapi.com](https://unirateapi.com).
<!-- unirate-ecosystem-footer:end -->

## License

MIT
