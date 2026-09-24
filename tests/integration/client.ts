import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { app } from "../../worker/app.ts";
import { authOptions } from "../../worker/auth/auth.ts";

export const ORIGIN = "http://localhost";

// Test-only instance: same config and secret as the app, plus helpers to create signed sessions.
const baseOptions = authOptions(env, ORIGIN);
const testAuth = betterAuth({ ...baseOptions, plugins: [...baseOptions.plugins, testUtils()] });

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/** Sends a request through the real Worker app with the given session headers. */
export async function request<T = any>(
  method: string,
  path: string,
  options: { headers?: Headers; json?: unknown; form?: FormData; origin?: string } = {},
): Promise<ApiResult<T>> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  if (options.origin) headers.set("Origin", options.origin);
  const ctx = createExecutionContext();
  const response = await app.request(`${ORIGIN}/api${path}`, { method, headers, body }, env, ctx);
  await waitOnExecutionContext(ctx);
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body (e.g. attachment download)
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  headers: Headers;
  get<T = any>(path: string): Promise<ApiResult<T>>;
  post<T = any>(path: string, json?: unknown): Promise<ApiResult<T>>;
  patch<T = any>(path: string, json?: unknown): Promise<ApiResult<T>>;
  put<T = any>(path: string, json?: unknown): Promise<ApiResult<T>>;
  delete<T = any>(path: string): Promise<ApiResult<T>>;
  upload<T = any>(path: string, form: FormData): Promise<ApiResult<T>>;
}

let counter = 0;

/** Creates a user with a real signed Better Auth session (via the test-utils plugin). */
export async function createUser(name: string): Promise<TestUser> {
  const ctx = await testAuth.$context;
  counter += 1;
  const email = `${name.toLowerCase()}.${Date.now()}.${counter}@example.com`;
  const user = await ctx.test.saveUser(ctx.test.createUser({ email, name, emailVerified: true }));
  const headers = await ctx.test.getAuthHeaders({ userId: user.id });
  return {
    id: user.id,
    email,
    name,
    headers,
    get: (path) => request("GET", path, { headers }),
    post: (path, json) => request("POST", path, { headers, json: json ?? {} }),
    patch: (path, json) => request("PATCH", path, { headers, json: json ?? {} }),
    put: (path, json) => request("PUT", path, { headers, json: json ?? {} }),
    delete: (path) => request("DELETE", path, { headers }),
    upload: (path, form) => request("POST", path, { headers, form }),
  };
}

/** Creates a brewery owned (admin) by `owner`. */
export async function createBrewery(owner: TestUser, name = "Testbryggeri"): Promise<string> {
  const response = await owner.post<{ id: string }>("/breweries", { name });
  if (response.status !== 201) throw new Error(`createBrewery failed: ${JSON.stringify(response.body)}`);
  return response.body.id;
}

/** Invites `member` to the brewery and accepts the invite. */
export async function addMember(owner: TestUser, breweryId: string, member: TestUser, role: "admin" | "member" = "member") {
  const invite = await owner.post<{ id: string }>(`/breweries/${breweryId}/invites`, { email: member.email, role });
  if (invite.status !== 201) throw new Error(`invite failed: ${JSON.stringify(invite.body)}`);
  const accepted = await member.post(`/invites/${invite.body.id}/accept`);
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
}
