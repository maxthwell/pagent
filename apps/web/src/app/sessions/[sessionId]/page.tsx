"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { apiFetch, sseUrl } from "../../../lib/api";
import type { RunEvent } from "@pagent/shared";
import { Card, CardContent, CardHeader } from "../../../components/ui/card";
import { Textarea } from "../../../components/ui/textarea";
import { Button } from "../../../components/ui/button";
import Link from "next/link";
import { Markdown } from "../../../components/markdown";
import { ProfileModal, type Profile } from "../../../components/profile_modal";

type Message = {
  id: string;
  sessionId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  tokenInput: number | null;
  tokenInputCached: number | null;
  tokenInputUncached: number | null;
  tokenOutput: number | null;
  tokenTotal: number | null;
};

type Session = {
  id: string;
  projectId: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  tokenTotals: {
    tokenInput: number | null;
    tokenInputCached: number | null;
    tokenInputUncached: number | null;
    tokenOutput: number | null;
    tokenTotal: number | null;
  };
};

type Agent = {
  id: string;
  name: string;
  nationality: string | null;
  ethnicity: string | null;
  specialties: string | null;
  hobbies: string | null;
  gender: string | null;
  age: number | null;
  contactWechat: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  workExperience: string | null;
  avatarSvg: string | null;
};

type Me = {
  id: string;
  email: string;
  fullName: string | null;
  nationality: string | null;
  ethnicity: string | null;
  specialties: string | null;
  hobbies: string | null;
  gender: string | null;
  age: number | null;
  contactWechat: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  workExperience: string | null;
  avatarSvg: string | null;
};

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const streamBufRef = useRef("");
  const rafRef = useRef<number | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  const streamUrl = useMemo(() => (streamRunId ? sseUrl(`/v1/runs/${streamRunId}/events`) : null), [streamRunId]);

  const load = async () => {
    setError(null);
    const [sRes, mRes] = await Promise.all([
      apiFetch(`/v1/sessions/${sessionId}`),
      apiFetch(`/v1/sessions/${sessionId}/messages`)
    ]);
    if (!sRes.ok) {
      setError(`Failed to load session (${sRes.status}): ${await sRes.text().catch(() => "")}`);
      return;
    }
    if (!mRes.ok) {
      setError(`Failed to load messages (${mRes.status}): ${await mRes.text().catch(() => "")}`);
      return;
    }
    setSession(await sRes.json());
    setMessages(await mRes.json());
  };

  const loadMe = async () => {
    const res = await apiFetch("/v1/auth/me");
    if (!res.ok) return;
    setMe((await res.json()) as Me);
  };

  useEffect(() => {
    void load();
    void loadMe();
  }, [sessionId]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const res = await apiFetch(`/v1/agents/${session.agentId}`);
      if (!res.ok) return;
      setAgent((await res.json()) as Agent);
    })();
  }, [session?.agentId]);

  useEffect(() => {
    if (!streamUrl) return;
    streamBufRef.current = "";
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const es = new EventSource(streamUrl);
    es.addEventListener("run_event", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as RunEvent;
        if (ev.type === "assistant_delta") {
          streamBufRef.current += String((ev.payload as any).delta ?? "");
          if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = null;
              setStreamText(streamBufRef.current);
            });
          }
        }
        if (ev.type === "assistant_message") {
          streamBufRef.current = String((ev.payload as any).content ?? "");
          setStreamText(streamBufRef.current);
        }
        if (ev.type === "run_finished") {
          // refresh full state (assistant message persisted by worker)
          void load();
          setTimeout(() => setStreamRunId(null), 300);
        }
      } catch {
        // ignore
      }
    });
    es.onerror = () => {
      // keep browser retry
    };
    return () => {
      es.close();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [streamUrl]);

  const scrollToBottom = (behavior: ScrollBehavior) => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  };

  useEffect(() => {
    requestAnimationFrame(() => scrollToBottom("auto"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!atBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages.length]);

  useEffect(() => {
    if (!streamRunId) return;
    if (!atBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [streamText, streamRunId]);

  return (
    <main className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{session?.title ?? "Session"}</h1>
          <div className="mt-1 text-xs text-slate-500 font-mono">{sessionId}</div>
        </div>
        <div className="flex items-center gap-3">
          {session ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const ok = window.confirm(`Delete this session?\n\n${session.title}`);
                if (!ok) return;
                setError(null);
                const res = await apiFetch(`/v1/sessions/${sessionId}`, { method: "DELETE" });
                if (!res.ok && res.status !== 204) {
                  setError(`Failed to delete session (${res.status}): ${await res.text().catch(() => "")}`);
                  return;
                }
                window.location.href = `/agents/${session.agentId}/chat`;
              }}
            >
              Delete session
            </Button>
          ) : null}
          <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="/projects">
            Back
          </Link>
        </div>
        {session ? (
          <div className="text-xs text-slate-600">
            Tokens total:{" "}
            <span className="font-mono text-slate-900">{session.tokenTotals.tokenTotal ?? 0}</span>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {session ? (
        <Card>
          <CardHeader>
            <div className="text-sm font-semibold">Token totals</div>
            <div className="text-sm text-slate-600">Aggregated across messages with usage data.</div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-5 text-sm">
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">input</div>
                <div className="mt-1 font-mono">{session.tokenTotals.tokenInput ?? 0}</div>
              </div>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">input_cached</div>
                <div className="mt-1 font-mono">{session.tokenTotals.tokenInputCached ?? 0}</div>
              </div>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">input_uncached</div>
                <div className="mt-1 font-mono">{session.tokenTotals.tokenInputUncached ?? 0}</div>
              </div>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">output</div>
                <div className="mt-1 font-mono">{session.tokenTotals.tokenOutput ?? 0}</div>
              </div>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">total</div>
                <div className="mt-1 font-mono">{session.tokenTotals.tokenTotal ?? 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Messages</div>
          <div className="text-sm text-slate-600">Multi-turn context for this agent session.</div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div
            ref={listRef}
            onScroll={() => {
              const el = listRef.current;
              if (!el) return;
              atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
            }}
            className="grid gap-3 max-h-[520px] overflow-auto pr-1"
          >
            {messages.map((m) => (
              <div key={m.id} className="rounded-xl ring-1 ring-slate-200 bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    {m.role === "assistant" ? (
                      <button
                        className="flex items-center gap-2"
                        onClick={() => {
                          if (!agent) return;
                          setProfile({
                            title: "Agent resume",
                            avatarSvg: agent.avatarSvg,
                            displayName: agent.name,
                            nationality: agent.nationality,
                            ethnicity: agent.ethnicity,
                            specialties: agent.specialties,
                            hobbies: agent.hobbies,
                            gender: agent.gender,
                            age: agent.age,
                            contactWechat: agent.contactWechat,
                            contactPhone: agent.contactPhone,
                            contactEmail: agent.contactEmail,
                            workExperience: agent.workExperience
                          });
                        }}
                      >
                        <div
                          className="h-7 w-7 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center"
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: agent?.avatarSvg ?? "" }}
                        />
                        <div className="text-xs font-medium text-slate-700">{agent?.name ?? "assistant"}</div>
                      </button>
                    ) : (
                      <button
                        className="flex items-center gap-2"
                        onClick={() => {
                          if (!me) return;
                          setProfile({
                            title: "Your resume",
                            avatarSvg: me.avatarSvg,
                            displayName: me.fullName || me.email,
                            nationality: me.nationality,
                            ethnicity: me.ethnicity,
                            specialties: me.specialties,
                            hobbies: me.hobbies,
                            gender: me.gender,
                            age: me.age,
                            contactWechat: me.contactWechat,
                            contactPhone: me.contactPhone,
                            contactEmail: me.contactEmail,
                            workExperience: me.workExperience
                          });
                        }}
                      >
                        <div
                          className="h-7 w-7 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center"
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: me?.avatarSvg ?? "" }}
                        />
                        <div className="text-xs font-medium text-slate-700">{me ? me.fullName || me.email : "you"}</div>
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleString()}</div>
                </div>
                <div className="px-3 py-3">
                  {m.role === "assistant" ? (
                    <Markdown content={m.content} />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{m.content}</pre>
                  )}
                  {m.tokenTotal != null ? (
                    <div className="mt-2 text-xs text-slate-500 font-mono">
                      tokens: in={m.tokenInput ?? 0} out={m.tokenOutput ?? 0} total={m.tokenTotal ?? 0}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {streamRunId ? (
              <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50">
                <div className="px-3 py-2 border-b border-slate-200">
                  <button
                    className="flex items-center gap-2"
                    onClick={() => {
                      if (!agent) return;
                      setProfile({
                        title: "Agent resume",
                        avatarSvg: agent.avatarSvg,
                        displayName: agent.name,
                        nationality: agent.nationality,
                        ethnicity: agent.ethnicity,
                        specialties: agent.specialties,
                        hobbies: agent.hobbies,
                        gender: agent.gender,
                        age: agent.age,
                        contactWechat: agent.contactWechat,
                        contactPhone: agent.contactPhone,
                        contactEmail: agent.contactEmail,
                        workExperience: agent.workExperience
                      });
                    }}
                  >
                    <div
                      className="h-7 w-7 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: agent?.avatarSvg ?? "" }}
                    />
                    <div className="text-xs font-medium text-slate-700">{agent?.name ?? "assistant"} (streaming)</div>
                  </button>
                </div>
                <div className="px-3 py-3">
                  {streamText ? <Markdown content={streamText} /> : <div className="text-sm text-slate-500">…</div>}
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="grid gap-2">
            <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Send a message…" />
            <div className="flex justify-end">
              <Button
                disabled={!content.trim() || !!streamRunId}
                onClick={async () => {
                  setError(null);
                  setStreamText("");
                  if (!session) {
                    setError("Session not loaded yet.");
                    return;
                  }
                  const res = await apiFetch(`/v1/agents/${session.agentId}/send`, {
                    method: "POST",
                    body: JSON.stringify({ sessionId, content })
                  });
                  if (!res.ok) {
                    setError(`Failed to send (${res.status}): ${await res.text().catch(() => "")}`);
                    return;
                  }
                  const run = await res.json();
                  setContent("");
                  setStreamRunId(run.runId);
                }}
              >
                Send
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {profile ? <ProfileModal profile={profile} onClose={() => setProfile(null)} /> : null}
    </main>
  );
}
