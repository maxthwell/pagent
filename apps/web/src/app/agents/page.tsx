"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

type Project = { id: string; name: string };
type Agent = { id: string; projectId: string; name: string; defaultModel: string; createdAt: string; avatarSvg?: string | null };

export default function AgentsIndexPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentsByProject, setAgentsByProject] = useState<Record<string, Agent[]>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const pRes = await apiFetch("/v1/projects");
    if (!pRes.ok) {
      setError(`Failed to load projects (${pRes.status})`);
      return;
    }
    const ps = (await pRes.json()) as Project[];
    setProjects(ps);

    const entries = await Promise.all(
      ps.map(async (p) => {
        const aRes = await apiFetch(`/v1/projects/${p.id}/agents`);
        if (!aRes.ok) return [p.id, [] as Agent[]] as const;
        return [p.id, (await aRes.json()) as Agent[]] as const;
      })
    );
    setAgentsByProject(Object.fromEntries(entries));
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [projects, query]);

  const matchesAgent = (a: Agent) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || a.defaultModel.toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
  };

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="mt-1 text-sm text-slate-600">Browse agents across projects and jump into chat sessions.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects or agents…" />
          <Button variant="secondary" onClick={load} className="sm:w-28">
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {filteredProjects.map((p) => {
          const agents = (agentsByProject[p.id] ?? []).filter(matchesAgent);
          return (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">{p.id}</div>
                  </div>
                  <Link href={`/projects/${p.id}/agents`}>
                    <Button variant="secondary" size="sm">
                      Manage
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
                {agents.map((a) => (
                  <Link key={a.id} href={`/agents/${a.id}/chat`} className="block">
                    <div className="rounded-xl ring-1 ring-slate-200 bg-white p-3 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-2 min-w-0" title={a.name}>
                        <div
                          className="h-9 w-9 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0"
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: a.avatarSvg ?? "" }}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold leading-tight">{a.name}</div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {agents.length === 0 ? <div className="text-sm text-slate-500">No agents.</div> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
