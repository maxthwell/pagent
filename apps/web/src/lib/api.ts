import { API_BASE_URL } from "./env";
import { getTokens, setTokens, clearTokens } from "./auth";

function urlFor(path: string): string {
  if (!API_BASE_URL) return `/api${path}`;
  return `${API_BASE_URL}${path}`;
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const p = window.location.pathname;
  if (p.startsWith("/login") || p.startsWith("/register")) return;
  window.location.href = "/login";
}

async function tryRefresh(): Promise<boolean> {
  const tokens = getTokens();
  if (!tokens?.refreshToken) return false;

  const r = await fetch(urlFor("/v1/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken })
  });
  if (!r.ok) {
    clearTokens();
    return false;
  }
  const next = (await r.json()) as any;
  setTokens(next);
  return true;
}

export async function apiFetch(path: string, init?: RequestInit) {
  const doFetch = async () => {
    const tokens = getTokens();
    const headers = new Headers(init?.headers ?? {});
    // Only set JSON content-type when a body is present.
    if (init?.body !== undefined && headers.get("Content-Type") == null) {
      headers.set("Content-Type", "application/json");
    }
    if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    return fetch(urlFor(path), { ...init, headers });
  };

  const res = await doFetch();
  if (res.status !== 401) return res;

  const refreshed = await tryRefresh().catch(() => false);
  if (!refreshed) {
    clearTokens();
    redirectToLogin();
    return res;
  }

  const res2 = await doFetch();
  if (res2.status === 401) {
    clearTokens();
    redirectToLogin();
  }
  return res2;
}

export function sseUrl(path: string): string {
  const tokens = getTokens();
  const u = new URL(urlFor(path), typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (tokens?.accessToken) u.searchParams.set("accessToken", tokens.accessToken);
  return u.toString();
}
