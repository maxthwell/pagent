"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RunEvent } from "@pagent/shared";
import { apiFetch } from "../../../lib/api";
import { sseUrl } from "../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Markdown } from "../../../components/markdown";

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
  role: string;
};

type GroupView = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description?: string | null;
  notice?: string | null;
  createdAt: string;
  memberCount: number;
  members: Member[];
};

type GroupMessage = {
  id: string;
  senderType: "user" | "agent";
  content: string;
  createdAt: string;
  sender: { type: "user" | "agent"; id: string | null; name: string; avatarSvg: string | null };
};

export default function GroupDetailPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const [view, setView] = useState<GroupView | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNotice, setEditNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [streamRuns, setStreamRuns] = useState<{ runId: string; agentName: string; avatarSvg: string | null; text: string }[]>([]);

  const load = async () => {
    setError(null);
    const [gRes, mRes] = await Promise.all([apiFetch(`/v1/groups/${groupId}`), apiFetch(`/v1/groups/${groupId}/messages`)]);
    if (!gRes.ok) {
      setError(`Failed to load group (${gRes.status}): ${await gRes.text().catch(() => "")}`);
      return;
    }
    if (!mRes.ok) {
      setError(`Failed to load messages (${mRes.status}): ${await mRes.text().catch(() => "")}`);
      return;
    }
    const v = (await gRes.json()) as GroupView;
    setView(v);
    setEditName(v.name);
    setEditDescription(v.description ?? "");
    setEditNotice(v.notice ?? "");
    setMessages((await mRes.json()) as GroupMessage[]);
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

  const streamUrls = useMemo(() => {
    return streamRuns.map((r) => ({ runId: r.runId, url: sseUrl(`/v1/runs/${r.runId}/events`) }));
  }, [streamRuns]);

  useEffect(() => {
    if (streamUrls.length === 0) return;
    const sources: EventSource[] = [];
    for (const { runId, url } of streamUrls) {
      const es = new EventSource(url);
      sources.push(es);
      es.addEventListener("run_event", (e: MessageEvent) => {
        try {
          const ev = JSON.parse(e.data) as RunEvent;
          if (ev.type === "assistant_delta") {
            const delta = String((ev.payload as any).delta ?? "");
            setStreamRuns((prev) => prev.map((x) => (x.runId === runId ? { ...x, text: x.text + delta } : x)));
          }
          if (ev.type === "assistant_message") {
            const content = String((ev.payload as any).content ?? "");
            setStreamRuns((prev) => prev.map((x) => (x.runId === runId ? { ...x, text: content } : x)));
          }
          if (ev.type === "run_finished") {
            // Refresh persisted messages, then remove streaming item shortly after.
            void load();
            setTimeout(() => {
              setStreamRuns((prev) => prev.filter((x) => x.runId !== runId));
            }, 300);
          }
        } catch {
          // ignore
        }
      });
    }
    return () => {
      for (const s of sources) s.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrls.map((x) => x.runId).join("|")]);

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
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Notice / Announcement</span>
            <Textarea value={editNotice} onChange={(e) => setEditNotice(e.target.value)} rows={5} />
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
                      description: editDescription.trim() ? editDescription : null,
                      notice: editNotice.trim() ? editNotice : null
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
        <CardHeader>
          <div className="text-sm font-semibold">Group chat</div>
          <div className="text-sm text-slate-600">Group owner can @ agents. Mentioned agents will reply.</div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="max-h-[520px] overflow-auto rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className="flex items-start gap-2">
                <div
                  className="h-8 w-8 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: m.sender.avatarSvg ?? "" }}
                />
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">{m.sender.name}</span>{" "}
                    <span className="text-slate-400">· {new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    <Markdown content={m.content} />
                  </div>
                </div>
              </div>
            ))}
            {streamRuns.map((r) => (
              <div key={r.runId} className="flex items-start gap-2">
                <div
                  className="h-8 w-8 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: r.avatarSvg ?? "" }}
                />
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">{r.agentName}</span>{" "}
                    <span className="text-slate-400">· typing…</span>
                  </div>
                  <div className="mt-1 text-sm">
                    <Markdown content={r.text || ""} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <Textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} rows={3} placeholder='e.g. "@Alice @Bob: 1+2+...+100=?"' />
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">Tip: use @AgentName to mention.</div>
              <Button
                disabled={!chatInput.trim()}
                onClick={async () => {
                  setError(null);
                  const content = chatInput.trim();
                  setChatInput("");
                  const res = await apiFetch(`/v1/groups/${view.id}/send`, { method: "POST", body: JSON.stringify({ content }) });
                  if (!res.ok) {
                    setError(`Failed to send (${res.status}): ${await res.text().catch(() => "")}`);
                    return;
                  }
                  const data = (await res.json()) as {
                    messageId: string;
                    runs: { runId: string; agentId: string; agentName: string; avatarSvg: string | null }[];
                  };
                  await load();
                  if (data.runs.length > 0) {
                    setStreamRuns((prev) => [
                      ...prev,
                      ...data.runs.map((x) => ({ runId: x.runId, agentName: x.agentName, avatarSvg: x.avatarSvg, text: "" }))
                    ]);
                  }
                }}
              >
                Send
              </Button>
            </div>
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
