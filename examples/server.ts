// Minimal example: a standalone tRPC HTTP server exposing the UniRate API.
//
// Run with:
//   UNIRATE_API_KEY=your-key npx tsx examples/server.ts
//
// Then in a separate terminal:
//   curl 'http://127.0.0.1:3000/unirate.convert?input=%7B%22from%22%3A%22USD%22%2C%22to%22%3A%22EUR%22%2C%22amount%22%3A100%7D'

import { initTRPC } from "@trpc/server";
import { createHTTPServer } from "@trpc/server/adapters/standalone";

import { createUniRateRouter } from "@unirate/trpc";

const apiKey = process.env.UNIRATE_API_KEY;
if (!apiKey) {
  console.error("Set UNIRATE_API_KEY to run this example.");
  process.exit(1);
}

const t = initTRPC.create();

const appRouter = t.router({
  unirate: createUniRateRouter({ apiKey }),
});

export type AppRouter = typeof appRouter;

const port = Number(process.env.PORT ?? 3000);
createHTTPServer({ router: appRouter }).listen(port);
console.log(`tRPC server listening on http://127.0.0.1:${port}`);
