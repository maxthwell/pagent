"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RunEvent } from "@pagent/shared";
import { sseUrl, apiFetch } from "../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";

export default function RunPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string>("(loading)");

  const url = useMemo(() => sseUrl(`/v1/runs/${runId}/events`), [runId]);

  useEffect(() => {
    (async () => {
      const r = await apiFetch(`/v1/runs/${runId}`);
      if (r.ok) setStatus((await r.json()).status);
    })();
  }, [runId]);

  useEffect(() => {
    const es = new EventSource(url);
    es.addEventListener("run_event", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as RunEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "assistant_delta") setText((t) => t + String((ev.payload as any).delta ?? ""));
        if (ev.type === "status") setStatus(String((ev.payload as any).status ?? status));
        if (ev.type === "assistant_message") setText(String((ev.payload as any).content ?? ""));
      } catch {
        // ignore
      }
    });
    es.onerror = () => {
      // keep browser retry behavior
    };
    return () => es.close();
  }, [url]);

  return (
    <main className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Run</h1>
          <div className="mt-1 text-xs text-slate-500 font-mono">{runId}</div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={[
              "text-xs font-medium px-2 py-1 rounded-full ring-1",
              status === "succeeded"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : status === "failed"
                  ? "bg-rose-50 text-rose-800 ring-rose-200"
                  : status === "running"
                    ? "bg-sky-50 text-sky-800 ring-sky-200"
                    : "bg-slate-50 text-slate-700 ring-slate-200"
            ].join(" ")}
          >
            {status}
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              await apiFetch(`/v1/runs/${runId}/cancel`, { method: "POST" });
            }}
          >
            Cancel
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="text-sm font-semibold">Assistant output</div>
            <div className="text-sm text-slate-600">Streaming tokens (SSE) appear here.</div>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 ring-1 ring-slate-200 min-h-[240px]">
              {text || "…"}
            </pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="text-sm font-semibold">Events</div>
            <div className="text-sm text-slate-600">Run lifecycle, deltas, and errors.</div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[420px] overflow-auto rounded-xl ring-1 ring-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 w-16">#</th>
                    <th className="text-left font-medium px-3 py-2 w-40">Type</th>
                    <th className="text-left font-medium px-3 py-2">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.seq} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 text-slate-500 font-mono">{ev.seq}</td>
                      <td className="px-3 py-2 font-medium">{ev.type}</td>
                      <td className="px-3 py-2">
                        <pre className="whitespace-pre-wrap text-xs leading-5 text-slate-700">
                          {JSON.stringify(ev.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={3}>
                        Waiting for events…
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
