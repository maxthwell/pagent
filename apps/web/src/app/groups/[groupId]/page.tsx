"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";

type Member = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  fullName?: string | null;
  nationality?: string | null;
  ethnicity?: string | null;
  gender?: string | null;
  age?: number | null;
  defaultModel: string;
  avatarSvg?: string | null;
  joinedAt: string;
};

type GroupView = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description?: string | null;
  createdAt: string;
  memberCount: number;
  members: Member[];
};

export default function GroupDetailPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const [view, setView] = useState<GroupView | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    const res = await apiFetch(`/v1/groups/${groupId}`);
    if (!res.ok) {
      setError(`Failed to load group (${res.status}): ${await res.text().catch(() => "")}`);
      return;
    }
    const v = (await res.json()) as GroupView;
    setView(v);
    setEditName(v.name);
    setEditDescription(v.description ?? "");
  };

  useEffect(() => {
    void load();
  }, [groupId]);

  const members = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!view) return [];
    if (!q) return view.members;
    return view.members.filter((m) => {
      return (
        m.name.toLowerCase().includes(q) ||
        (m.fullName ?? "").toLowerCase().includes(q) ||
        m.projectName.toLowerCase().includes(q) ||
        (m.nationality ?? "").toLowerCase().includes(q) ||
        (m.ethnicity ?? "").toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }, [view, query]);

  if (!view) {
    return (
      <main className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Group</h1>
          <p className="mt-1 text-sm text-slate-600">Loading…</p>
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="grid gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{view.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Project: <span className="font-medium text-slate-900">{view.projectName}</span> · Members:{" "}
            <span className="font-medium text-slate-900">{view.memberCount}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/projects/${view.projectId}/groups`}>
            <Button variant="secondary" size="sm">
              Manage in project
            </Button>
          </Link>
          <Link href="/groups">
            <Button variant="ghost" size="sm">
              Back
            </Button>
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Group info</div>
          <div className="text-sm text-slate-600">Treat it like a WeChat group: name + description + members.</div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Created</span>
              <div className="h-10 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 flex items-center text-sm text-slate-700">
                {new Date(view.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Description</span>
            <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => load()} disabled={saving}>
              Reset
            </Button>
            <Button
              onClick={async () => {
                setError(null);
                setSaving(true);
                try {
                  const res = await apiFetch(`/v1/groups/${view.id}`, {
                    method: "PUT",
                    body: JSON.stringify({
                      name: editName.trim() || view.name,
                      description: editDescription.trim() ? editDescription : null
                    })
                  });
                  if (!res.ok) {
                    setError(`Failed to save (${res.status}): ${await res.text().catch(() => "")}`);
                    return;
                  }
                  await load();
                } finally {
                  setSaving(false);
                }
              }}
              disabled={!editName.trim() || saving}
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members…" />
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
        {members.map((m) => (
          <Card key={m.id} className="rounded-xl">
            <CardContent className="px-3 py-3">
              <Link href={`/agents/${m.id}/chat`} className="block">
                <div className="flex items-center gap-2 min-w-0" title={m.name}>
                  <div
                    className="h-9 w-9 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: m.avatarSvg ?? "" }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight">{m.name}</div>
                  </div>
                </div>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
