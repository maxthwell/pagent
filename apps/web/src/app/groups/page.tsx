"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

type Project = { id: string; name: string };
type Group = { id: string; projectId: string; name: string; description?: string | null; createdAt: string; memberCount: number };

function hashToHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function GroupsIndexPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [groupsByProject, setGroupsByProject] = useState<Record<string, Group[]>>({});
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
        const gRes = await apiFetch(`/v1/projects/${p.id}/groups`);
        if (!gRes.ok) return [p.id, [] as Group[]] as const;
        return [p.id, (await gRes.json()) as Group[]] as const;
      })
    );
    setGroupsByProject(Object.fromEntries(entries));
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [projects, query]);

  const matchesGroup = (g: Group) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      g.name.toLowerCase().includes(q) ||
      (g.description ?? "").toLowerCase().includes(q) ||
      g.id.toLowerCase().includes(q)
    );
  };

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Groups</h1>
        <p className="mt-1 text-sm text-slate-600">“群”：like chat rooms. View members and manage groups per project.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects or groups…" />
          <Button variant="secondary" onClick={load} className="sm:w-28">
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {filteredProjects.map((p) => {
          const groups = (groupsByProject[p.id] ?? []).filter(matchesGroup);
          return (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">{p.id}</div>
                  </div>
                  <Link href={`/projects/${p.id}/groups`}>
                    <Button variant="secondary" size="sm">
                      Manage
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
                {groups.map((g) => (
                  <Link key={g.id} href={`/groups/${g.id}`} className="block">
                    <div
                      className="rounded-xl ring-1 ring-slate-200 bg-white p-3 hover:bg-slate-50 transition-colors"
                      title={`${g.name} · members: ${g.memberCount}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-9 w-9 rounded-xl ring-1 ring-black/5 flex items-center justify-center text-white font-semibold shrink-0"
                          style={{ backgroundColor: `hsl(${hashToHue(g.id)} 65% 45%)` }}
                          aria-hidden="true"
                        >
                          {g.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold leading-tight">{g.name}</div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {groups.length === 0 ? <div className="text-sm text-slate-500">No groups.</div> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
