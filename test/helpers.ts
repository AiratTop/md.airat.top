import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";

export const BASE = "https://md.airat.top";

/**
 * Drives the Worker the way the platform does, context and all.
 *
 * Typed rather than inferred: `src/index.js` is plain JavaScript, so TypeScript reads its
 * handler as possibly returning nothing and every assertion downstream inherits the
 * doubt.
 */
export async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const request = new Request(`${BASE}${path}`, init);

  // Each call arrives from its own address unless the test says otherwise. The rate
  // limiter is a real binding in this runtime and meters per address, so without this one
  // test's traffic exhausts the next one's allowance and the suite fails in whatever
  // order it happens to run. `fromAddress` is how a test opts into sharing one.
  if (!request.headers.has("CF-Connecting-IP")) {
    request.headers.set("CF-Connecting-IP", uniqueAddress());
  }

  const response = (await worker.fetch(request, env, ctx)) as Response;
  await waitOnExecutionContext(ctx);
  return response;
}

let addressCounter = 0;

/** A fresh address per call, in a range reserved for documentation (RFC 5737). */
export function uniqueAddress(): string {
  addressCounter += 1;
  return `203.0.113.${addressCounter % 256}.${addressCounter}`;
}

/** Sends a request as a specific caller, for the tests that are about the rate limiter. */
export function fromAddress(address: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", address);
  return call(path, { ...init, headers });
}

/** `Response.json()` is `unknown`, which is right and unhelpful in a test. */
export async function readJson<T = Record<string, any>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function post(path: string, payload: unknown): Promise<Response> {
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
