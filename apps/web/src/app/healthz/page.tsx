"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { apiFetch } from "../../lib/api";

type Health = { ok: boolean; status: number; body: string };

export default function HealthzPage() {
  const [h, setH] = useState<Health>({ ok: false, status: 0, body: "Loading…" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/healthz");
        const body = await res.text().catch(() => "");
        if (!cancelled) setH({ ok: res.ok, status: res.status, body });
      } catch (e: any) {
        if (!cancelled) setH({ ok: false, status: 0, body: e?.message ? String(e.message) : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Health</h1>
        <p className="mt-1 text-sm text-slate-600">Checks API reachability via the Next.js BFF proxy.</p>
      </div>
      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">API /healthz</div>
          <div className="text-sm text-slate-600">Status: {h.ok ? "OK" : "FAIL"} ({h.status || "error"})</div>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-sm text-slate-800">{h.body || "(empty)"}</pre>
        </CardContent>
      </Card>
    </main>
  );
}
