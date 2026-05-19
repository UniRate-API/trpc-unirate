import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  InvalidCurrencyError,
  InvalidRequestError,
  ProRequiredError,
  RateLimitError,
  UniRateClient,
  UniRateError,
} from "../src/client.js";
import { makeFetch } from "./mock-fetch.js";

describe("UniRateClient", () => {
  it("requires an apiKey", () => {
    expect(() => new UniRateClient({ apiKey: "" })).toThrow(UniRateError);
  });

  it("sends api_key + Accept JSON on /api/rates", async () => {
    const { fetch, calls, mock } = makeFetch({
      "/api/rates": { body: { rate: "0.92" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    const r = await c.getRate("USD", "eur");
    expect(r).toBe(0.92);
    expect(calls[0]).toContain("from=USD");
    expect(calls[0]).toContain("to=EUR");
    expect(calls[0]).toContain("api_key=k");
    const headers = (mock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["User-Agent"]).toMatch(/^unirate-trpc\//);
  });

  it("returns full rates map when `to` is omitted", async () => {
    const { fetch } = makeFetch({
      "/api/rates": { body: { rates: { EUR: "0.92", GBP: "0.79" } } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    const rates = await c.getRate("USD");
    expect(rates).toEqual({ EUR: 0.92, GBP: 0.79 });
  });

  it("converts with /api/convert", async () => {
    const { fetch, calls } = makeFetch({
      "/api/convert": { body: { result: "92.50" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    expect(await c.convert("EUR", 100, "USD")).toBe(92.5);
    expect(calls[0]).toMatch(/amount=100/);
  });

  it("lists currencies", async () => {
    const { fetch } = makeFetch({
      "/api/currencies": { body: { currencies: ["USD", "EUR", "GBP"] } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    expect(await c.listCurrencies()).toEqual(["USD", "EUR", "GBP"]);
  });

  it("maps 401 to AuthenticationError", async () => {
    const { fetch } = makeFetch({
      "/api/rates": { status: 401, body: { error: "bad key" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    await expect(c.getRate("USD", "EUR")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps 403 to ProRequiredError (historical)", async () => {
    const { fetch } = makeFetch({
      "/api/historical/rates": {
        status: 403,
        body: { error: "Pro subscription required" },
      },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    await expect(c.getHistoricalRate("2024-01-01", 1, "USD", "EUR")).rejects.toBeInstanceOf(
      ProRequiredError,
    );
  });

  it("maps 404 to InvalidCurrencyError", async () => {
    const { fetch } = makeFetch({
      "/api/rates": { status: 404, body: { error: "not found" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    await expect(c.getRate("USD", "XXX")).rejects.toBeInstanceOf(InvalidCurrencyError);
  });

  it("maps 400 to InvalidRequestError", async () => {
    const { fetch } = makeFetch({
      "/api/rates": { status: 400, body: { error: "bad params" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    await expect(c.getRate("USD", "EUR")).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it("maps 429 to RateLimitError", async () => {
    const { fetch } = makeFetch({
      "/api/rates": { status: 429, body: { error: "too many" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    await expect(c.getRate("USD", "EUR")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("maps an HTML 404 body to InvalidCurrencyError without crashing", async () => {
    const { fetch } = makeFetch({
      "/api/currencies": { status: 404, rawText: "<html>404</html>" },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    await expect(c.listCurrencies()).rejects.toBeInstanceOf(UniRateError);
  });

  it("historical with `to` and amount=1 returns single rate", async () => {
    const { fetch } = makeFetch({
      "/api/historical/rates": { body: { rate: "0.91" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    expect(await c.getHistoricalRate("2024-01-01", 1, "USD", "EUR")).toBe(0.91);
  });

  it("historical with `to` and amount>1 returns converted result", async () => {
    const { fetch } = makeFetch({
      "/api/historical/rates": { body: { result: "91.00" } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    expect(await c.getHistoricalRate("2024-01-01", 100, "USD", "EUR")).toBe(91);
  });

  it("historical without `to` and amount=1 returns rates map", async () => {
    const { fetch } = makeFetch({
      "/api/historical/rates": { body: { rates: { EUR: "0.91", GBP: "0.78" } } },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    expect(await c.getHistoricalRate("2024-01-01", 1, "USD")).toEqual({
      EUR: 0.91,
      GBP: 0.78,
    });
  });

  it("getTimeSeries returns the data map flattened to numbers", async () => {
    const { fetch, calls } = makeFetch({
      "/api/historical/timeseries": {
        body: {
          amount: 1,
          base: "USD",
          start_date: "2024-01-01",
          end_date: "2024-01-02",
          total_days: 2,
          data: {
            "2024-01-01": { EUR: "0.92", GBP: "0.79" },
            "2024-01-02": { EUR: "0.93", GBP: "0.80" },
          },
        },
      },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    const series = await c.getTimeSeries("2024-01-01", "2024-01-02", 1, "USD", ["EUR", "GBP"]);
    expect(series["2024-01-01"]).toEqual({ EUR: 0.92, GBP: 0.79 });
    expect(calls[0]).toContain("currencies=EUR%2CGBP");
  });

  it("getVATRates passes country as uppercase", async () => {
    const { fetch, calls } = makeFetch({
      "/api/vat/rates": {
        body: {
          country: "DE",
          vat_data: { country_code: "DE", country_name: "Germany", vat_rate: 19 },
        },
      },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    const r = await c.getVATRates("de");
    expect(calls[0]).toContain("country=DE");
    expect(r).toMatchObject({ country: "DE" });
  });

  it("propagates network errors as UniRateError", async () => {
    const { fetch } = makeFetch({
      "/api/rates": { error: new Error("ECONNRESET") },
    });
    const c = new UniRateClient({ apiKey: "k", fetch });
    await expect(c.getRate("USD", "EUR")).rejects.toBeInstanceOf(UniRateError);
  });
});
