"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import { Button } from "../../../../components/ui/button";
import Link from "next/link";

type Provider = { id: string; name: string; type: string; configJson?: any; hasApiKey?: boolean };
type Skill = { name: string; description: string; path: string };
type Group = { id: string; name: string; memberCount?: number };
type Agent = {
  id: string;
  name: string;
  defaultModel: string;
  createdAt: string;
  providerAccountId: string | null;
  providerAccount?: Provider | null;
  skillPaths?: string[];
  groupMembers?: { group: Group }[];

  fullName?: string | null;
  nationality?: string | null;
  specialties?: string | null;
  hobbies?: string | null;
  gender?: string | null;
  age?: number | null;
  contact?: string | null;
  workExperience?: string | null;
  avatarSvg?: string | null;
};

function modelOptionsForProvider(p: Provider | undefined): string[] {
  const raw = p?.configJson?.models;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [];
}

export default function AgentsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("Default Agent");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [defaultModel, setDefaultModel] = useState("deepseek-chat");
  const [providerAccountId, setProviderAccountId] = useState<string>("");
  const [selectedSkillPaths, setSelectedSkillPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [useCustomModel, setUseCustomModel] = useState<boolean>(false);
  const [edit, setEdit] = useState<{ agentId: string; skillPaths: string[] } | null>(null);
  const [editGroups, setEditGroups] = useState<{ agentId: string; groupIds: string[] } | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(`pagent_active_group_${projectId}`) ?? "";
  });
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(60);

  const [fullName, setFullName] = useState("");
  const [nationality, setNationality] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState<string>("");
  const [contact, setContact] = useState("");
  const [workExperience, setWorkExperience] = useState("");

  const load = async () => {
    setError(null);
    const [aRes, pRes, sRes, gRes] = await Promise.all([
      apiFetch(`/v1/projects/${projectId}/agents`),
      apiFetch(`/v1/projects/${projectId}/providers`),
      apiFetch(`/v1/skills`),
      apiFetch(`/v1/projects/${projectId}/groups`)
    ]);
    if (!aRes.ok) {
      setError(`Failed to load agents (${aRes.status})`);
      return;
    }
    if (!pRes.ok) {
      setError(`Failed to load providers (${pRes.status})`);
      return;
    }
    if (!sRes.ok) {
      setError(`Failed to load skills (${sRes.status})`);
      return;
    }
    if (!gRes.ok) {
      setError(`Failed to load groups (${gRes.status})`);
      return;
    }
    setAgents(await aRes.json());
    setProviders(await pRes.json());
    setSkills(await sRes.json());
    setGroups(await gRes.json());
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`pagent_active_group_${projectId}`, activeGroupId);
  }, [activeGroupId, projectId]);

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      if (!activeGroupId) return true;
      const ids = (a.groupMembers ?? []).map((m) => m.group.id);
      return ids.includes(activeGroupId);
    });
  }, [agents, activeGroupId]);

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const pagedAgents = useMemo(() => {
    const start = (clampedPage - 1) * pageSize;
    return filteredAgents.slice(start, start + pageSize);
  }, [filteredAgents, clampedPage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [activeGroupId, pageSize]);

  useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage);
  }, [page, clampedPage]);

  const selectedProvider = providers.find((p) => p.id === providerAccountId);
  const modelOptions = modelOptionsForProvider(selectedProvider);

  useEffect(() => {
    if (useCustomModel) return;
    if (modelOptions.length === 0) return;
    if (!modelOptions.includes(defaultModel)) setDefaultModel(modelOptions[0]!);
  }, [useCustomModel, modelOptions, defaultModel]);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="mt-1 text-sm text-slate-600">Define system prompt and model defaults for this project.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">Filter by group (cached per project)</div>
          <select
            className="h-10 w-full sm:w-[320px] rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
            value={activeGroupId}
            onChange={(e) => setActiveGroupId(e.target.value)}
          >
            <option value="">(all agents)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Create agent</div>
          <div className="text-sm text-slate-600">Start simple, iterate later (tools/RAG/provider UI can be added next).</div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = window.confirm("Pre-create up to 100 agents with unique names and avatars for this project?\n\nIf you already have agents, it will only create the missing ones to reach 100.");
                if (!ok) return;
                setError(null);
                const res = await apiFetch(`/v1/projects/${projectId}/agents/seed`, {
                  method: "POST",
                  body: JSON.stringify({ count: 100 })
                });
                if (!res.ok) {
                  setError(`Failed to seed agents (${res.status}): ${await res.text().catch(() => "")}`);
                  return;
                }
                await load();
              }}
            >
              Pre-create 100 agents
            </Button>
            <div className="text-xs text-slate-500">Creates missing demo agents to reach 100 total.</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
            </label>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Default model</span>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={useCustomModel}
                    onChange={(e) => setUseCustomModel(e.target.checked)}
                  />
                  Custom
                </label>
              </div>
              {!useCustomModel && modelOptions.length > 0 ? (
                <select
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  placeholder="deepseek-chat / gpt-4o-mini"
                />
              )}
            </div>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Provider (optional)</span>
            <select
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
              value={providerAccountId}
              onChange={(e) => setProviderAccountId(e.target.value)}
            >
              <option value="">(none / mock)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
            {providerAccountId && selectedProvider?.type === "openai_compat" && selectedProvider?.hasApiKey === false ? (
              <div className="text-xs text-rose-600">Selected provider has no API key configured.</div>
            ) : null}
          </label>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-slate-600">Skills</div>
            {skills.length === 0 ? (
              <div className="text-xs text-slate-500">
                No skills found on server.
              </div>
            ) : (
              <div className="grid gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                {skills.map((s) => {
                  const checked = selectedSkillPaths.includes(s.path);
                  return (
                    <label key={s.path} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedSkillPaths((prev) => {
                            if (e.target.checked) return Array.from(new Set([...prev, s.path]));
                            return prev.filter((x) => x !== s.path);
                          });
                        }}
                      />
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-xs text-slate-600">{s.description}</div>
                        <div className="text-[11px] text-slate-500 font-mono break-all">{s.path}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">System prompt</span>
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={5} />
          </label>

          <details className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
            <summary className="cursor-pointer select-none text-sm font-medium text-slate-800">Resume / Profile (optional)</summary>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Full name</span>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Alex Chen" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Nationality</span>
                  <Input value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. China" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Gender</span>
                  <Input value={gender} onChange={(e) => setGender(e.target.value)} placeholder="female/male/nonbinary" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Age</span>
                  <Input value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 28" />
                </label>
                <label className="grid gap-1 sm:col-span-2">
                  <span className="text-xs font-medium text-slate-600">Contact</span>
                  <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="email / phone / link" />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Specialties</span>
                <Input value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="e.g. TypeScript, RAG, Security" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Hobbies</span>
                <Input value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder="e.g. reading, hiking" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Work experience</span>
                <Textarea
                  value={workExperience}
                  onChange={(e) => setWorkExperience(e.target.value)}
                  rows={4}
                  placeholder="- 2022–2024: ...\n- 2024–now: ..."
                />
              </label>
            </div>
          </details>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                setError(null);
                const res = await apiFetch("/v1/agents", {
                  method: "POST",
                  body: JSON.stringify({
                    projectId,
                    name,
                    systemPrompt,
                    defaultModel,
                    providerAccountId: providerAccountId || null,
                    skillPaths: selectedSkillPaths,
                    toolsJson: {},
                    ragEnabled: false,

                    fullName: fullName.trim() || undefined,
                    nationality: nationality.trim() || undefined,
                    specialties: specialties.trim() || undefined,
                    hobbies: hobbies.trim() || undefined,
                    gender: gender.trim() || undefined,
                    age: age.trim() ? Number(age) : undefined,
                    contact: contact.trim() || undefined,
                    workExperience: workExperience.trim() || undefined
                  })
                });
                if (!res.ok) {
                  if (res.status === 409) {
                    setError(`Agent name already exists in this project: "${name}"`);
                  } else {
                    setError(`Failed to create agent (${res.status}): ${await res.text().catch(() => "")}`);
                  }
                  return;
                }
                await load();
              }}
              disabled={!name.trim() || !systemPrompt.trim() || !defaultModel.trim()}
            >
              Create Agent
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3">
          <div className="text-sm text-slate-600">
            Showing <span className="font-medium text-slate-800">{filteredAgents.length}</span> agents
            {activeGroupId ? " in this group" : ""}.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            {activeGroupId ? (
              <Link href={`/groups/${activeGroupId}`}>
                <Button variant="secondary" size="sm" className="h-9 px-3 text-xs">
                  View group members
                </Button>
              </Link>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">Page size</span>
              <select
                className="h-9 rounded-lg bg-white px-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[30, 60, 90, 120].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-9 px-3 text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={clampedPage <= 1}
              >
                Prev
              </Button>
              <div className="text-xs text-slate-600 tabular-nums">
                {clampedPage} / {totalPages}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-9 px-3 text-xs"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={clampedPage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
        {pagedAgents.map((a) => (
          <Card key={a.id} className="rounded-xl group">
            <CardContent className="px-3 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="h-9 w-9 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: a.avatarSvg ?? "" }}
                />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold leading-tight">{a.name}</div>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link href={`/agents/${a.id}/chat`}>
                  <Button variant="secondary" size="sm" className="h-8 px-2 text-xs">
                    Chat
                  </Button>
                </Link>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() =>
                      setEditGroups({
                        agentId: a.id,
                        groupIds: (a.groupMembers ?? []).map((m) => m.group.id)
                      })
                    }
                  >
                    群
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setEdit({ agentId: a.id, skillPaths: a.skillPaths ?? [] })}
                  >
                    技能
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={async () => {
                      const ok = window.confirm(`Delete agent "${a.name}"?\nRuns will remain in history.`);
                      if (!ok) return;
                      try {
                        setError(null);
                        const res = await apiFetch(`/v1/agents/${a.id}`, { method: "DELETE" });
                        if (!res.ok && res.status !== 204) {
                          setError(`Failed to delete agent (${res.status}): ${await res.text().catch(() => "")}`);
                          return;
                        }
                        await load();
                      } catch (e: any) {
                        setError(`Failed to delete agent: ${e?.message ? String(e.message) : String(e)}`);
                      }
                    }}
                  >
                    删
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editGroups ? (
        <div className="fixed inset-0 bg-black/30 p-4 grid place-items-center" onMouseDown={() => setEditGroups(null)}>
          <div className="w-full max-w-3xl" onMouseDown={(e) => e.stopPropagation()}>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">Edit agent groups</div>
                    <div className="mt-1 text-sm text-slate-600">Select or unselect groups (群) for this agent.</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEditGroups(null)}>
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                {groups.length === 0 ? (
                  <div className="text-sm text-slate-600">
                    No groups yet. Create one in <Link className="underline" href={`/projects/${projectId}/groups`}>Groups</Link>.
                  </div>
                ) : (
                  <div className="grid gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 max-h-[420px] overflow-auto">
                    {groups.map((g) => {
                      const checked = editGroups.groupIds.includes(g.id);
                      return (
                        <label key={g.id} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setEditGroups((prev) => {
                                if (!prev) return prev;
                                const next = e.target.checked
                                  ? Array.from(new Set([...prev.groupIds, g.id]))
                                  : prev.groupIds.filter((x) => x !== g.id);
                                return { ...prev, groupIds: next };
                              });
                            }}
                          />
                          <div>
                            <div className="text-sm font-medium">{g.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono break-all">{g.id}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setEditGroups(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      setError(null);
                      const res = await apiFetch(`/v1/agents/${editGroups.agentId}/groups`, {
                        method: "PUT",
                        body: JSON.stringify({ groupIds: editGroups.groupIds })
                      });
                      if (!res.ok) {
                        setError(`Failed to update groups (${res.status}): ${await res.text().catch(() => "")}`);
                        return;
                      }
                      setEditGroups(null);
                      await load();
                    }}
                  >
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {edit ? (
        <div className="fixed inset-0 bg-black/30 p-4 grid place-items-center" onMouseDown={() => setEdit(null)}>
          <div className="w-full max-w-3xl" onMouseDown={(e) => e.stopPropagation()}>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">Edit agent skills</div>
                    <div className="mt-1 text-sm text-slate-600">Select or unselect filesystem-provided skills.</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 max-h-[420px] overflow-auto">
                  {skills.map((s) => {
                    const checked = edit.skillPaths.includes(s.path);
                    return (
                      <label key={s.path} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setEdit((prev) => {
                              if (!prev) return prev;
                              const next = e.target.checked
                                ? Array.from(new Set([...prev.skillPaths, s.path]))
                                : prev.skillPaths.filter((p) => p !== s.path);
                              return { ...prev, skillPaths: next };
                            });
                          }}
                        />
                        <div>
                          <div className="text-sm font-medium">{s.name}</div>
                          <div className="text-xs text-slate-600">{s.description}</div>
                          <div className="text-[11px] text-slate-500 font-mono break-all">{s.path}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setEdit(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      setError(null);
                      const res = await apiFetch(`/v1/agents/${edit.agentId}`, {
                        method: "PUT",
                        body: JSON.stringify({ skillPaths: edit.skillPaths })
                      });
                      if (!res.ok) {
                        setError(`Failed to update agent (${res.status}): ${await res.text().catch(() => "")}`);
                        return;
                      }
                      setEdit(null);
                      await load();
                    }}
                  >
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </main>
  );
}
