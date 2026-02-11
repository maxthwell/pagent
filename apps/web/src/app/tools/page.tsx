"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

type Tool = {
  id: string;
  name: string;
  description: string;
  jsonSchema: any;
  createdAt: string;
};

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await apiFetch("/v1/tools");
    if (!res.ok) {
      setError(`Failed to load tools (${res.status}): ${await res.text().catch(() => "")}`);
      return;
    }
    setTools((await res.json()) as Tool[]);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }, [tools, query]);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tools</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tool library for OpenAI-compatible tool calls. Tools are <span className="font-medium">system-managed</span>
          (implementation is hardcoded); this page is read-only.
        </p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools…" />
          <Button variant="secondary" onClick={load} className="sm:w-28">
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
        {filtered.map((t) => (
          <Card key={t.id} className="rounded-xl group">
            <CardContent className="px-3 py-3">
              <div className="truncate text-[13px] font-semibold leading-tight" title={t.name}>
                {t.name}
              </div>
              <div className="mt-1 truncate text-[11px] text-slate-600" title={t.description}>
                {t.description}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer select-none text-xs text-slate-600">schema</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-50 ring-1 ring-slate-200 p-2 text-[11px]">
                  {JSON.stringify(t.jsonSchema, null, 2)}
                </pre>
              </details>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
