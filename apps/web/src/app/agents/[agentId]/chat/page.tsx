"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { useParams } from "next/navigation";
import type { RunEvent } from "@pagent/shared";
import { apiFetch, sseUrl } from "../../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Textarea } from "../../../../components/ui/textarea";
import { Markdown } from "../../../../components/markdown";
import { ProfileModal, type Profile } from "../../../../components/profile_modal";

type Session = { id: string; title: string; updatedAt: string };
type Message = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  tokenInput: number | null;
  tokenInputCached: number | null;
  tokenInputUncached: number | null;
  tokenOutput: number | null;
  tokenTotal: number | null;
};

type SessionDetail = {
  id: string;
  title: string;
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

export default function AgentChatPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const streamBufRef = useRef("");
  const rafRef = useRef<number | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  const streamUrl = useMemo(() => (streamRunId ? sseUrl(`/v1/runs/${streamRunId}/events`) : null), [streamRunId]);

  const grouped = useMemo(() => {
    type DayGroup = { day: string; sessions: Session[]; recent: boolean; active: boolean };
    type MonthGroup = { month: string; days: Map<string, DayGroup>; recent: boolean; active: boolean };
    type YearGroup = { year: string; months: Map<string, MonthGroup>; recent: boolean; active: boolean };
    const years = new Map<string, YearGroup>();

    const now = Date.now();
    const recentCutoff = now - 7 * 24 * 60 * 60 * 1000;

    const active = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
    const activeDate = active ? new Date(active.updatedAt) : null;
    const activeY = activeDate ? String(activeDate.getFullYear()) : null;
    const activeM = activeDate ? String(activeDate.getMonth() + 1).padStart(2, "0") : null;
    const activeD = activeDate ? String(activeDate.getDate()).padStart(2, "0") : null;

    for (const s of sessions) {
      const dt = new Date(s.updatedAt);
      const year = String(dt.getFullYear());
      const month = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      const isRecent = dt.getTime() >= recentCutoff;

      let yg = years.get(year);
      if (!yg) {
        yg = { year, months: new Map(), recent: false, active: false };
        years.set(year, yg);
      }
      if (isRecent) yg.recent = true;
      if (activeY === year) yg.active = true;

      let mg = yg.months.get(month);
      if (!mg) {
        mg = { month, days: new Map(), recent: false, active: false };
        yg.months.set(month, mg);
      }
      if (isRecent) mg.recent = true;
      if (activeY === year && activeM === month) mg.active = true;

      let dg = mg.days.get(day);
      if (!dg) {
        dg = { day, sessions: [], recent: false, active: false };
        mg.days.set(day, dg);
      }
      if (isRecent) dg.recent = true;
      if (activeY === year && activeM === month && activeD === day) dg.active = true;

      dg.sessions.push(s);
    }

    for (const yg of years.values()) {
      for (const mg of yg.months.values()) {
        for (const dg of mg.days.values()) {
          dg.sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        }
      }
    }

    const yearList = Array.from(years.values()).sort((a, b) => Number(b.year) - Number(a.year));
    return yearList.map((yg) => {
      const monthList = Array.from(yg.months.values()).sort((a, b) => Number(b.month) - Number(a.month));
      return {
        year: yg.year,
        recent: yg.recent,
        active: yg.active,
        months: monthList.map((mg) => {
          const dayList = Array.from(mg.days.values()).sort((a, b) => Number(b.day) - Number(a.day));
          return { month: mg.month, recent: mg.recent, active: mg.active, days: dayList };
        })
      };
    });
  }, [sessions, activeSessionId]);

  const loadSessions = async () => {
    setError(null);
    const res = await apiFetch(`/v1/agents/${agentId}/sessions`);
    if (!res.ok) {
      setError(`Failed to load sessions (${res.status}): ${await res.text().catch(() => "")}`);
      return;
    }
    const list = (await res.json()) as Session[];
    setSessions(list);
    if (!activeSessionId && list.length > 0) setActiveSessionId(list[0]!.id);
  };

  const loadAgent = async () => {
    const res = await apiFetch(`/v1/agents/${agentId}`);
    if (!res.ok) return;
    setAgent((await res.json()) as Agent);
  };

  const loadMe = async () => {
    const res = await apiFetch(`/v1/auth/me`);
    if (!res.ok) return;
    setMe((await res.json()) as Me);
  };

  const loadActive = async () => {
    if (!activeSessionId) {
      setSession(null);
      setMessages([]);
      return;
    }
    setError(null);
    const [sRes, mRes] = await Promise.all([
      apiFetch(`/v1/sessions/${activeSessionId}`),
      apiFetch(`/v1/sessions/${activeSessionId}/messages`)
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

  useEffect(() => {
    void loadAgent();
    void loadMe();
    void loadSessions();
  }, [agentId]);

  useEffect(() => {
    void loadActive();
  }, [activeSessionId]);

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
          void loadSessions();
          void loadActive();
          setTimeout(() => setStreamRunId(null), 300);
        }
      } catch {
        // ignore
      }
    });
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
  }, [activeSessionId]);

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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agent chat</h1>
          <div className="mt-1 text-xs text-slate-500 font-mono">{agentId}</div>
        </div>
        <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="/projects">
          Back
        </Link>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Sessions</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActiveSessionId(null);
                  setSession(null);
                  setMessages([]);
                }}
              >
                New chat
              </Button>
            </div>
            <div className="text-sm text-slate-600">Select a session, or start a new one by sending a message.</div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {grouped.map((y) => (
              <details
                key={y.year}
                open={y.recent || y.active}
                className="rounded-xl bg-white ring-1 ring-slate-200 p-2"
              >
                <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800 px-1 py-1">
                  {y.year}
                </summary>
                <div className="mt-2 grid gap-2">
                  {y.months.map((m) => (
                    <details
                      key={`${y.year}-${m.month}`}
                      open={m.recent || m.active}
                      className="rounded-lg bg-slate-50 ring-1 ring-slate-200 p-2"
                    >
                      <summary className="cursor-pointer select-none text-xs font-medium text-slate-700 px-1 py-1">
                        {m.month}
                      </summary>
                      <div className="mt-2 grid gap-2">
                        {m.days.map((d) => (
                          <details
                            key={`${y.year}-${m.month}-${d.day}`}
                            open={d.recent || d.active}
                            className="rounded-lg bg-white ring-1 ring-slate-200"
                          >
                            <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-600 px-2 py-2">
                              {d.day}
                            </summary>
                            <div className="grid gap-1 p-2 pt-0">
                              {d.sessions.map((s) => (
                                <div key={s.id} className="flex items-center gap-2">
                                  <button
                                    onClick={() => setActiveSessionId(s.id)}
                                    className={[
                                      "flex-1 text-left rounded-lg px-2 py-2 ring-1 transition",
                                      activeSessionId === s.id
                                        ? "bg-slate-900 text-white ring-slate-900"
                                        : "bg-white ring-slate-200 hover:bg-slate-50"
                                    ].join(" ")}
                                  >
                                    <div className="text-sm font-medium line-clamp-1">{s.title}</div>
                                    <div className={activeSessionId === s.id ? "text-xs text-white/70" : "text-xs text-slate-500"}>
                                      {new Date(s.updatedAt).toLocaleString()}
                                    </div>
                                  </button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                      const ok = window.confirm(`Delete this session?\n\n${s.title}`);
                                      if (!ok) return;
                                      setError(null);
                                      const res = await apiFetch(`/v1/sessions/${s.id}`, { method: "DELETE" });
                                      if (!res.ok && res.status !== 204) {
                                        setError(`Failed to delete session (${res.status}): ${await res.text().catch(() => "")}`);
                                        return;
                                      }
                                      if (activeSessionId === s.id) {
                                        setActiveSessionId(null);
                                        setSession(null);
                                        setMessages([]);
                                      }
                                      await loadSessions();
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}
            {sessions.length === 0 ? <div className="text-sm text-slate-500">No sessions yet.</div> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">{session?.title ?? (activeSessionId ? "Session" : "New chat")}</div>
                <div className="text-sm text-slate-600">
                  {session ? (
                    <>
                      Token total: <span className="font-mono text-slate-900">{session.tokenTotals.tokenTotal ?? 0}</span>
                    </>
                  ) : (
                    "Send a message to create a session automatically."
                  )}
                </div>
              </div>
              {activeSessionId ? <div className="text-xs text-slate-500 font-mono">{activeSessionId}</div> : null}
            </div>
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
              {messages.length === 0 && !streamRunId ? (
                <div className="text-sm text-slate-500">No messages yet.</div>
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
                    const res = await apiFetch(`/v1/agents/${agentId}/send`, {
                      method: "POST",
                      body: JSON.stringify({ sessionId: activeSessionId ?? undefined, content })
                    });
                    if (!res.ok) {
                      setError(`Failed to send (${res.status}): ${await res.text().catch(() => "")}`);
                      return;
                    }
                    const data = await res.json();
                    setContent("");
                    if (!activeSessionId) setActiveSessionId(data.sessionId);
                    setStreamRunId(data.runId);
                  }}
                >
                  Send
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {profile ? <ProfileModal profile={profile} onClose={() => setProfile(null)} /> : null}
    </main>
  );
}
