export const runtime = "nodejs";

type Params = { path: string[] };

function targetUrl(req: Request, params: Params): URL {
  const internalBase = (process.env.PAGENT_INTERNAL_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
  const p = (params.path ?? []).join("/");
  const u = new URL(`${internalBase}/${p}`);
  u.search = new URL(req.url).search;
  return u;
}

async function proxy(req: Request, params: Params): Promise<Response> {
  const url = targetUrl(req, params);
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("connection");

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    // Node.js fetch requires duplex for streaming request bodies.
    init.duplex = "half";
  }

  const upstream = await fetch(url, init);
  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete("content-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders
  });
}

export async function GET(req: Request, { params }: { params: Params }) {
  return proxy(req, params);
}
export async function POST(req: Request, { params }: { params: Params }) {
  return proxy(req, params);
}
export async function PUT(req: Request, { params }: { params: Params }) {
  return proxy(req, params);
}
export async function PATCH(req: Request, { params }: { params: Params }) {
  return proxy(req, params);
}
export async function DELETE(req: Request, { params }: { params: Params }) {
  return proxy(req, params);
}

