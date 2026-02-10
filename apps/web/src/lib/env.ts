const useBff = (process.env.NEXT_PUBLIC_USE_BFF ?? "true") !== "false";

export const API_BASE_URL = useBff
  ? ""
  : (process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:4000");

export const USE_BFF = useBff;
