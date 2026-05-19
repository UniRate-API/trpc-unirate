// Tiny zero-dependency fetch wrapper around the UniRate REST API.
//
// Stays dependency-free so the package adds no runtime weight beyond
// its peer dependencies (@trpc/server, zod). Native fetch is required
// (Node 18.17+, the package's declared engines floor).
//
// `Accept: application/json` is set on every request because UniRate's
// /api/currencies endpoint returns an HTML 404 without it — see the
// workspace CLAUDE.md "Key gotchas" #2.

export class UniRateError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "UniRateError";
    this.status = status;
    this.body = body;
  }
}

export class AuthenticationError extends UniRateError {
  constructor(message = "Missing or invalid API key", body?: unknown) {
    super(message, 401, body);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends UniRateError {
  constructor(message = "Rate limit exceeded", body?: unknown) {
    super(message, 429, body);
    this.name = "RateLimitError";
  }
}

export class InvalidCurrencyError extends UniRateError {
  constructor(message = "Currency not found or no data available", body?: unknown) {
    super(message, 404, body);
    this.name = "InvalidCurrencyError";
  }
}

export class InvalidRequestError extends UniRateError {
  constructor(message = "Invalid request parameters", body?: unknown) {
    super(message, 400, body);
    this.name = "InvalidRequestError";
  }
}

export class ProRequiredError extends UniRateError {
  constructor(message = "Endpoint requires a Pro subscription", body?: unknown) {
    super(message, 403, body);
    this.name = "ProRequiredError";
  }
}

export interface UniRateClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}

const DEFAULT_BASE_URL = "https://api.unirateapi.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = "unirate-trpc/0.1.0";

const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number.parseFloat(v) : (v as number);
  if (!Number.isFinite(n)) {
    throw new UniRateError(`Non-numeric value: ${String(v)}`);
  }
  return n;
};

const toRates = (raw: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = toNum(v);
  return out;
};

export interface VATEntry {
  country_code: string;
  country_name: string;
  vat_rate: number;
}

export interface VATRatesAll {
  total_countries: number;
  date: string;
  vat_rates: Record<string, VATEntry>;
}

export interface VATRateOne {
  country: string;
  vat_data: VATEntry;
}

export interface HistoricalLimitsResponse {
  total_currencies: number;
  data_source: string;
  currencies: Record<
    string,
    {
      earliest_date: string;
      latest_date: string;
      total_days: number;
      description: string;
    }
  >;
}

export class UniRateClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #userAgent: string;

  constructor(opts: UniRateClientOptions) {
    if (!opts.apiKey) throw new UniRateError("apiKey is required");
    this.#apiKey = opts.apiKey;
    this.#baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    if (typeof this.#fetch !== "function") {
      throw new UniRateError("global fetch is unavailable; pass `fetch` explicitly");
    }
  }

  async #get<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(this.#baseUrl + path);
    url.searchParams.set("api_key", this.#apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": this.#userAgent,
        },
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      throw new UniRateError(`Request to ${path} failed: ${msg}`);
    }
    clearTimeout(timer);

    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        if (!res.ok) {
          throw new UniRateError(`HTTP ${res.status} from ${path}`, res.status, text);
        }
        throw new UniRateError(`Non-JSON response from ${path}`, res.status, text);
      }
    }

    if (!res.ok) {
      const detail =
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : undefined;
      switch (res.status) {
        case 400:
          throw new InvalidRequestError(detail ?? "Invalid request parameters", body);
        case 401:
          throw new AuthenticationError(detail ?? "Missing or invalid API key", body);
        case 403:
          throw new ProRequiredError(
            detail ?? "Endpoint requires a Pro subscription",
            body,
          );
        case 404:
          throw new InvalidCurrencyError(
            detail ?? "Currency not found or no data available",
            body,
          );
        case 429:
          throw new RateLimitError(detail ?? "Rate limit exceeded", body);
        default:
          throw new UniRateError(
            detail ?? `HTTP ${res.status} from ${path}`,
            res.status,
            body,
          );
      }
    }

    return body as T;
  }

  async getRate(from: string, to?: string): Promise<number | Record<string, number>> {
    const params: Record<string, string | undefined> = { from: from.toUpperCase() };
    if (to) params.to = to.toUpperCase();
    const raw = await this.#get<{
      rate?: string | number;
      rates?: Record<string, string | number>;
    }>("/api/rates", params);
    if (to) {
      if (raw.rate === undefined) throw new UniRateError("Malformed /api/rates response", undefined, raw);
      return toNum(raw.rate);
    }
    if (!raw.rates) throw new UniRateError("Malformed /api/rates response", undefined, raw);
    return toRates(raw.rates);
  }

  async convert(to: string, amount: number, from: string): Promise<number> {
    const raw = await this.#get<{ result?: string | number }>("/api/convert", {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      amount,
    });
    if (raw.result === undefined) {
      throw new UniRateError("Malformed /api/convert response", undefined, raw);
    }
    return toNum(raw.result);
  }

  async listCurrencies(): Promise<string[]> {
    const raw = await this.#get<{ currencies?: string[] }>("/api/currencies", {});
    if (!Array.isArray(raw.currencies)) {
      throw new UniRateError("Malformed /api/currencies response", undefined, raw);
    }
    return raw.currencies;
  }

  async getHistoricalRate(
    date: string,
    amount: number,
    from: string,
    to?: string,
  ): Promise<number | Record<string, number>> {
    const params: Record<string, string | number | undefined> = {
      date,
      amount,
      from: from.toUpperCase(),
    };
    if (to) params.to = to.toUpperCase();
    const raw = await this.#get<{
      rate?: string | number;
      result?: string | number;
      rates?: Record<string, string | number>;
      results?: Record<string, string | number>;
    }>("/api/historical/rates", params);

    if (to) {
      const v = amount === 1 ? raw.rate : raw.result;
      if (v === undefined) {
        throw new UniRateError("Malformed /api/historical/rates response", undefined, raw);
      }
      return toNum(v);
    }
    const map = amount === 1 ? raw.rates : raw.results;
    if (!map) {
      throw new UniRateError("Malformed /api/historical/rates response", undefined, raw);
    }
    return toRates(map);
  }

  async getTimeSeries(
    startDate: string,
    endDate: string,
    amount: number,
    base: string,
    currencies?: string[],
  ): Promise<Record<string, Record<string, number>>> {
    const params: Record<string, string | number | undefined> = {
      start_date: startDate,
      end_date: endDate,
      amount,
      base: base.toUpperCase(),
    };
    if (currencies && currencies.length > 0) {
      params.currencies = currencies.map((c) => c.toUpperCase()).join(",");
    }
    const raw = await this.#get<{ data?: Record<string, Record<string, string | number>> }>(
      "/api/historical/timeseries",
      params,
    );
    if (!raw.data) {
      throw new UniRateError("Malformed /api/historical/timeseries response", undefined, raw);
    }
    const out: Record<string, Record<string, number>> = {};
    for (const [day, rates] of Object.entries(raw.data)) out[day] = toRates(rates);
    return out;
  }

  async getHistoricalLimits(): Promise<HistoricalLimitsResponse> {
    return this.#get<HistoricalLimitsResponse>("/api/historical/limits", {});
  }

  async getVATRates(country?: string): Promise<VATRatesAll | VATRateOne> {
    const params: Record<string, string | undefined> = {};
    if (country) params.country = country.toUpperCase();
    return this.#get<VATRatesAll | VATRateOne>("/api/vat/rates", params);
  }
}
