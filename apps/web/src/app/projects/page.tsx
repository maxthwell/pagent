"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

type Project = { id: string; name: string; createdAt: string };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await apiFetch("/v1/projects");
    if (!res.ok) {
      setError("Failed to load projects (are you logged in?)");
      return;
    }
    setProjects(await res.json());
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-1 text-sm text-slate-600">Workspaces for agents, configs, and runs.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Create a project</div>
              <div className="text-sm text-slate-600">Projects keep your agents and runs organized.</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              onClick={async () => {
                const res = await apiFetch("/v1/projects", { method: "POST", body: JSON.stringify({ name }) });
                if (res.ok) {
                  setName("");
                  await load();
                }
              }}
              disabled={!name.trim()}
              className="sm:w-32"
            >
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="mt-1 text-xs text-slate-500 font-mono">{p.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/skills`}>
                  <Button variant="secondary" size="sm">
                    Skills
                  </Button>
                </Link>
                <Link href={`/projects/${p.id}/groups`}>
                  <Button variant="secondary" size="sm">
                    Groups
                  </Button>
                </Link>
                <Link href={`/projects/${p.id}/providers`}>
                  <Button variant="secondary" size="sm">
                    Providers
                  </Button>
                </Link>
                <Link href={`/projects/${p.id}/agents`}>
                  <Button variant="secondary" size="sm">
                    Agents
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
