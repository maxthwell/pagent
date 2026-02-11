"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../components/ui/card";
import { Textarea } from "../../../components/ui/textarea";
import { Button } from "../../../components/ui/button";

type Project = { id: string; name: string };
type Agent = { id: string; name: string };

export default function NewRunPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [userMessage, setUserMessage] = useState("Hello pagent");
  const [error, setError] = useState<string | null>(null);

  const selectedProjectId = useMemo(() => projectId || projects[0]?.id || "", [projectId, projects]);

  useEffect(() => {
    (async () => {
      const pRes = await apiFetch("/v1/projects");
      if (!pRes.ok) return;
      const ps = (await pRes.json()) as Project[];
      setProjects(ps);
      const pid = ps[0]?.id;
      if (pid) {
        setProjectId(pid);
        const aRes = await apiFetch(`/v1/projects/${pid}/agents`);
        if (aRes.ok) setAgents(await aRes.json());
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedProjectId) return;
      const aRes = await apiFetch(`/v1/projects/${selectedProjectId}/agents`);
      if (aRes.ok) setAgents(await aRes.json());
    })();
  }, [selectedProjectId]);

  useEffect(() => {
    if (!agentId && agents.length > 0) setAgentId(agents[0]!.id);
  }, [agents, agentId]);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New Run</h1>
        <p className="mt-1 text-sm text-slate-600">Start an agent run and stream events in real time.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Run configuration</div>
          <div className="text-sm text-slate-600">Pick a project and agent, then provide a message.</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Project</span>
              <select
                className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
                value={selectedProjectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Agent</span>
              <select
                className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="">(select)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <div className="text-xs text-slate-500">
                Tip: to use <span className="font-mono">deepseek-chat</span>, add a DeepSeek provider then select its model in Agents.
              </div>
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">User message</span>
            <Textarea rows={7} value={userMessage} onChange={(e) => setUserMessage(e.target.value)} />
          </label>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                setError(null);
                if (!selectedProjectId) {
                  setError("Missing project");
                  return;
                }
                if (!agentId) {
                  setError("Missing agent (create one first)");
                  return;
                }
                const res = await apiFetch("/v1/runs", {
                  method: "POST",
                  body: JSON.stringify({ projectId: selectedProjectId, agentId, userMessage })
                });
                if (!res.ok) {
                  const body = await res.text().catch(() => "");
                  setError(`Failed to start run (${res.status}): ${body}`);
                  return;
                }
                const run = await res.json();
                router.push(`/runs/${run.id}`);
              }}
              disabled={!selectedProjectId || !agentId || !userMessage.trim()}
            >
              Start Run
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
