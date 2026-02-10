"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import { Button } from "../../../../components/ui/button";

type Group = {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  createdAt: string;
  memberCount: number;
};

function hashToHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function GroupsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await apiFetch(`/v1/projects/${projectId}/groups`);
    if (!res.ok) {
      setError(`Failed to load groups (${res.status}): ${await res.text().catch(() => "")}`);
      return;
    }
    setGroups((await res.json()) as Group[]);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  return (
    <main className="grid gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Groups</h1>
          <p className="mt-1 text-sm text-slate-600">“群”：Agents can belong to multiple groups.</p>
        </div>
        <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="/projects">
          Back
        </Link>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Create group</div>
          <div className="text-sm text-slate-600">Group names are unique within a project.</div>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
          />
          <Button
            className="sm:w-32"
            disabled={!name.trim()}
            onClick={async () => {
              setError(null);
              const res = await apiFetch(`/v1/projects/${projectId}/groups`, {
                method: "POST",
                body: JSON.stringify({ name, description: description.trim() || undefined })
              });
              if (!res.ok) {
                setError(`Failed to create group (${res.status}): ${await res.text().catch(() => "")}`);
                return;
              }
              setName("");
              setDescription("");
              await load();
            }}
          >
            Create
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search groups…" />
          <Button variant="secondary" onClick={load} className="sm:w-28">
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
        {filtered.map((g) => (
          <Card key={g.id} className="rounded-xl group">
            <CardContent className="px-3 py-3">
              <Link href={`/groups/${g.id}`} className="block">
                <div className="flex items-center gap-2 min-w-0" title={`${g.name} · members: ${g.memberCount}`}>
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
              </Link>
              <div className="mt-2 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={async () => {
                    const ok = window.confirm(`Delete group \"${g.name}\"?\n\nAgents will be unassigned from this group.`);
                    if (!ok) return;
                    setError(null);
                    const res = await apiFetch(`/v1/groups/${g.id}`, { method: "DELETE" });
                    if (!res.ok && res.status !== 204) {
                      setError(`Failed to delete group (${res.status}): ${await res.text().catch(() => "")}`);
                      return;
                    }
                    await load();
                  }}
                >
                  删
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
