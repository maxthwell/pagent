import type { AuthTokens } from "@pagent/shared";

const key = "pagent_tokens";

export function getTokens(): AuthTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

export function setTokens(tokens: AuthTokens) {
  window.localStorage.setItem(key, JSON.stringify(tokens));
  try {
    window.dispatchEvent(new Event("pagent_auth_change"));
  } catch {
    // ignore
  }
}

export function clearTokens() {
  window.localStorage.removeItem(key);
  try {
    window.dispatchEvent(new Event("pagent_auth_change"));
  } catch {
    // ignore
  }
}
