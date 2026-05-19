import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { createUniRateRouter } from "../src/router.js";
import { UniRateClient } from "../src/client.js";
import { makeFetch } from "./mock-fetch.js";

const mkClient = (routes: Parameters<typeof makeFetch>[0]) => {
  const fh = makeFetch(routes);
  return { fh, client: new UniRateClient({ apiKey: "k", fetch: fh.fetch }) };
};

const mkCaller = (routes: Parameters<typeof makeFetch>[0]) => {
  const { client, fh } = mkClient(routes);
  const router = createUniRateRouter({ client });
  return { caller: router.createCaller({}), fh };
};

describe("createUniRateRouter", () => {
  it("requires apiKey or client", () => {
    expect(() => createUniRateRouter({})).toThrow(/apiKey.*client/);
  });

  it("convert: returns a number and uppercases input currencies", async () => {
    const { caller, fh } = mkCaller({
      "/api/convert": { body: { result: "92.50" } },
    });
    const result = await caller.convert({ from: "usd", to: "eur", amount: 100 });
    expect(result).toBe(92.5);
    expect(fh.calls[0]).toContain("from=USD");
    expect(fh.calls[0]).toContain("to=EUR");
  });

  it("convert: default amount is 1", async () => {
    const { caller, fh } = mkCaller({
      "/api/convert": { body: { result: "0.92" } },
    });
    const r = await caller.convert({ from: "USD", to: "EUR" });
    expect(r).toBe(0.92);
    expect(fh.calls[0]).toContain("amount=1");
  });

  it("convert: rejects non-3-letter currency codes via Zod", async () => {
    const { caller } = mkCaller({});
    await expect(
      caller.convert({ from: "US", to: "EUR", amount: 1 }),
    ).rejects.toThrow(/3 letters/);
  });

  it("convert: rejects non-positive amount via Zod", async () => {
    const { caller } = mkCaller({});
    await expect(
      caller.convert({ from: "USD", to: "EUR", amount: -1 }),
    ).rejects.toThrow(/positive/);
  });

  it("rate: returns a single number when `to` is given", async () => {
    const { caller } = mkCaller({
      "/api/rates": { body: { rate: "0.92" } },
    });
    const r = await caller.rate({ from: "USD", to: "EUR" });
    expect(r).toBe(0.92);
  });

  it("rate: returns a map when `to` is omitted", async () => {
    const { caller } = mkCaller({
      "/api/rates": { body: { rates: { EUR: "0.92", GBP: "0.79" } } },
    });
    const r = await caller.rate({});
    expect(r).toEqual({ EUR: 0.92, GBP: 0.79 });
  });

  it("rates: always returns the full map", async () => {
    const { caller, fh } = mkCaller({
      "/api/rates": { body: { rates: { EUR: "0.92" } } },
    });
    const r = await caller.rates({ base: "USD" });
    expect(r).toEqual({ EUR: 0.92 });
    expect(fh.calls[0]).not.toContain("to=");
  });

  it("historical: requires YYYY-MM-DD", async () => {
    const { caller } = mkCaller({});
    await expect(
      caller.historical({ date: "2024/01/01", from: "USD", to: "EUR", amount: 1 }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("historical: 403 maps to TRPCError FORBIDDEN", async () => {
    const { caller } = mkCaller({
      "/api/historical/rates": {
        status: 403,
        body: { error: "Pro subscription required" },
      },
    });
    try {
      await caller.historical({ date: "2024-01-01", from: "USD", to: "EUR", amount: 1 });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("currencies: returns the list", async () => {
    const { caller } = mkCaller({
      "/api/currencies": { body: { currencies: ["USD", "EUR", "GBP"] } },
    });
    expect(await caller.currencies()).toEqual(["USD", "EUR", "GBP"]);
  });

  it("timeSeries: joins currencies and returns numeric data", async () => {
    const { caller, fh } = mkCaller({
      "/api/historical/timeseries": {
        body: {
          amount: 1,
          base: "USD",
          start_date: "2024-01-01",
          end_date: "2024-01-02",
          total_days: 2,
          data: { "2024-01-01": { EUR: "0.92" }, "2024-01-02": { EUR: "0.93" } },
        },
      },
    });
    const r = await caller.timeSeries({
      startDate: "2024-01-01",
      endDate: "2024-01-02",
      base: "USD",
      currencies: ["eur"],
      amount: 1,
    });
    expect(r["2024-01-01"]).toEqual({ EUR: 0.92 });
    expect(fh.calls[0]).toContain("currencies=EUR");
  });

  it("vat: returns single-country payload", async () => {
    const { caller } = mkCaller({
      "/api/vat/rates": {
        body: {
          country: "DE",
          vat_data: { country_code: "DE", country_name: "Germany", vat_rate: 19 },
        },
      },
    });
    const r = await caller.vat({ country: "de" });
    expect(r).toMatchObject({ country: "DE" });
  });

  it("UniRate 401 maps to TRPCError UNAUTHORIZED", async () => {
    const { caller } = mkCaller({
      "/api/rates": { status: 401, body: { error: "bad key" } },
    });
    try {
      await caller.rate({ from: "USD", to: "EUR" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("UNAUTHORIZED");
    }
  });

  it("UniRate 429 maps to TRPCError TOO_MANY_REQUESTS", async () => {
    const { caller } = mkCaller({
      "/api/rates": { status: 429, body: { error: "slow down" } },
    });
    try {
      await caller.rate({ from: "USD", to: "EUR" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    }
  });

  it("can be nested inside a host router via t.router({ unirate })", async () => {
    const fh = makeFetch({ "/api/rates": { body: { rates: { EUR: "0.92" } } } });
    const t = initTRPC.create();
    const client = new UniRateClient({ apiKey: "k", fetch: fh.fetch });
    const app = t.router({
      unirate: createUniRateRouter({ client }),
    });
    const caller = app.createCaller({});
    const r = await caller.unirate.rate({});
    expect(r).toEqual({ EUR: 0.92 });
  });
});
