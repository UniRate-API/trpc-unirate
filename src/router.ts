// Drop-in tRPC router factory that wraps the UniRate REST API.
//
// Usage in a consumer app:
//
//   import { initTRPC } from "@trpc/server";
//   import { createUniRateRouter } from "@unirate/trpc";
//
//   const t = initTRPC.create();
//   export const appRouter = t.router({
//     unirate: createUniRateRouter({ apiKey: process.env.UNIRATE_API_KEY! }),
//   });
//
// The returned object is a fully-built tRPC v11 router. It can be nested
// under any key in your own router via the object form above.

import { TRPCError, initTRPC } from "@trpc/server";
import { z } from "zod";

import {
  AuthenticationError,
  InvalidCurrencyError,
  InvalidRequestError,
  ProRequiredError,
  RateLimitError,
  UniRateClient,
  UniRateError,
  type UniRateClientOptions,
} from "./client.js";

export interface CreateUniRateRouterOptions extends Partial<UniRateClientOptions> {
  /** Required unless `client` is supplied. */
  apiKey?: string;
  /** Inject a pre-built client (for tests, or to share with the rest of your app). */
  client?: UniRateClient;
}

const currency = z
  .string()
  .trim()
  .length(3, "currency code must be 3 letters")
  .transform((s) => s.toUpperCase());

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const positiveAmount = z
  .number()
  .finite("amount must be finite")
  .positive("amount must be positive");

const inputs = {
  convert: z.object({
    from: currency,
    to: currency,
    amount: positiveAmount.default(1),
  }),
  rate: z.object({
    from: currency.default("USD"),
    to: currency.optional(),
  }),
  rates: z.object({
    base: currency.default("USD"),
  }),
  historical: z.object({
    date: isoDate,
    from: currency.default("USD"),
    to: currency.optional(),
    amount: positiveAmount.default(1),
  }),
  timeSeries: z.object({
    startDate: isoDate,
    endDate: isoDate,
    base: currency.default("USD"),
    amount: positiveAmount.default(1),
    currencies: z.array(currency).max(50).optional(),
  }),
  vat: z.object({
    country: z
      .string()
      .trim()
      .length(2, "country code must be 2 letters")
      .transform((s) => s.toUpperCase())
      .optional(),
  }),
};

export const uniRateInputSchemas = inputs;

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    if (err instanceof AuthenticationError) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: err.message, cause: err });
    }
    if (err instanceof ProRequiredError) {
      throw new TRPCError({ code: "FORBIDDEN", message: err.message, cause: err });
    }
    if (err instanceof InvalidCurrencyError) {
      throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
    }
    if (err instanceof InvalidRequestError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
    }
    if (err instanceof RateLimitError) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: err.message, cause: err });
    }
    if (err instanceof UniRateError) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err.message,
        cause: err,
      });
    }
    throw err;
  }
};

const resolveClient = (opts: CreateUniRateRouterOptions): UniRateClient => {
  if (opts.client) return opts.client;
  if (!opts.apiKey) {
    throw new UniRateError("createUniRateRouter requires `apiKey` or `client`");
  }
  return new UniRateClient({ ...opts, apiKey: opts.apiKey });
};

/**
 * Build a tRPC v11 router exposing the UniRate API.
 *
 * Creates its own `initTRPC.create()` instance and returns a fully-built
 * router with seven query procedures: `convert`, `rate`, `rates`,
 * `historical`, `timeSeries`, `currencies`, `vat`. Nest the result under
 * any key in your own router via the object form:
 *
 *   t.router({ unirate: createUniRateRouter({ apiKey }) })
 *
 * Errors from the UniRate API are mapped to typed `TRPCError` codes
 * (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`,
 * `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`) so client-side
 * `useQuery({ onError })` handlers see standard tRPC error shapes.
 */
export const createUniRateRouter = (opts: CreateUniRateRouterOptions) => {
  const client = resolveClient(opts);
  const t = initTRPC.create();
  const proc = t.procedure;
  return t.router({
    convert: proc.input(inputs.convert).query(({ input }) =>
      wrap(() => client.convert(input.to, input.amount, input.from)),
    ),
    rate: proc.input(inputs.rate).query(({ input }) =>
      wrap(() => client.getRate(input.from, input.to)),
    ),
    rates: proc.input(inputs.rates).query(({ input }) =>
      wrap(() => client.getRate(input.base) as Promise<Record<string, number>>),
    ),
    historical: proc.input(inputs.historical).query(({ input }) =>
      wrap(() => client.getHistoricalRate(input.date, input.amount, input.from, input.to)),
    ),
    timeSeries: proc.input(inputs.timeSeries).query(({ input }) =>
      wrap(() =>
        client.getTimeSeries(
          input.startDate,
          input.endDate,
          input.amount,
          input.base,
          input.currencies,
        ),
      ),
    ),
    currencies: proc.query(() => wrap(() => client.listCurrencies())),
    vat: proc.input(inputs.vat).query(({ input }) =>
      wrap(() => client.getVATRates(input.country)),
    ),
  });
};

export type UniRateRouter = ReturnType<typeof createUniRateRouter>;
