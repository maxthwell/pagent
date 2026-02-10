"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { Markdown } from "../../components/markdown";

type Skill = { name: string; description: string; path: string; headMarkdown?: string };

type SkillView =
  | { type: "file"; ref: string; abs: string; name: string; description: string; path: string; dir: string; body: string; files: { name: string; type: "file" | "dir" }[]; rawMarkdown: string }
  | { type: "dir"; ref: string; abs: string; entries: { name: string; type: "dir" | "file"; ref: string }[] };

function refFromSkillPath(p: string): string | null {
  const m = p.match(/[?&]ref=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function SkillsCatalogPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SkillView | null>(null);

  const load = async () => {
    setError(null);
    const res = await apiFetch("/v1/skills");
    if (!res.ok) {
      setError(`Failed to load skills (${res.status}): ${await res.text().catch(() => "")}`);
      return;
    }
    setSkills(await res.json());
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.path.toLowerCase().includes(q));
  }, [skills, query]);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Skills</h1>
        <p className="mt-1 text-sm text-slate-600">
          Read-only skills provided by the server. Agents can select or unselect skills, but cannot edit them.
        </p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills…" />
          <Button variant="secondary" onClick={load} className="sm:w-28">
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((s) => (
          <Card key={s.path}>
            <CardContent className="grid gap-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="mt-2 max-h-40 overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                    <div className="text-xs text-slate-500 mb-2">Preview</div>
                    {s.headMarkdown ? (
                      <Markdown content={s.headMarkdown} />
                    ) : (
                      <div className="text-sm text-slate-600">{s.description}</div>
                    )}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    setError(null);
                    const ref = refFromSkillPath(s.path);
                    if (!ref) {
                      setError("Invalid skill path (missing ref)");
                      return;
                    }
                    const res = await apiFetch(`/v1/docs/view?ref=${encodeURIComponent(ref)}`);
                    if (!res.ok) {
                      setError(`Failed to view skill (${res.status}): ${await res.text().catch(() => "")}`);
                      return;
                    }
                    setView(await res.json());
                  }}
                >
                  View
                </Button>
              </div>
              <div className="text-xs text-slate-500 font-mono break-all">{s.path}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {view ? (
        <div className="fixed inset-0 bg-black/30 p-4 grid place-items-center" onMouseDown={() => setView(null)}>
          <div className="w-full max-w-4xl" onMouseDown={(e) => e.stopPropagation()}>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  {view.type === "file" ? (
                    <div>
                      <div className="text-lg font-semibold">{view.name}</div>
                      <div className="mt-1 text-sm text-slate-600">{view.description}</div>
                      <div className="mt-2 text-xs text-slate-500 font-mono break-all">{view.abs}</div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-lg font-semibold">Directory</div>
                      <div className="mt-2 text-xs text-slate-500 font-mono break-all">{view.abs}</div>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setView(null)}>
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {view.type === "file" ? (
                  <>
                    <div>
                      <div className="text-xs font-medium text-slate-600 mb-2">Directory</div>
                      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 text-xs text-slate-700">
                        <div className="font-mono break-all mb-2">{view.dir}</div>
                        <div className="flex flex-wrap gap-2">
                          {view.files.map((f) => (
                            <span key={f.name} className="px-2 py-1 rounded-lg bg-white ring-1 ring-slate-200">
                              {f.type === "dir" ? `${f.name}/` : f.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-4 mb-2">
                        <div className="text-xs font-medium text-slate-600">Markdown</div>
                        <a
                          className="text-xs font-medium text-slate-900 underline underline-offset-4"
                          href={view.path}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open raw
                        </a>
                      </div>
                      <div className="max-h-[520px] overflow-auto rounded-xl bg-white ring-1 ring-slate-200 p-4">
                        <Markdown content={view.body} />
                      </div>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-slate-600">Show raw markdown</summary>
                        <div className="mt-2">
                          <Textarea readOnly value={view.rawMarkdown} rows={14} className="font-mono text-xs leading-5" />
                        </div>
                      </details>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 text-xs text-slate-700">
                    <div className="text-xs font-medium text-slate-600 mb-2">Entries</div>
                    <div className="flex flex-wrap gap-2">
                      {view.entries.map((e) => (
                        <span key={e.ref} className="px-2 py-1 rounded-lg bg-white ring-1 ring-slate-200">
                          {e.type === "dir" ? `${e.name}/` : e.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </main>
  );
}
