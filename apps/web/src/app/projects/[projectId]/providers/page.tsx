"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "../../../../lib/api";
import { Card, CardContent, CardHeader } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";

type Provider = {
  id: string;
  projectId: string;
  type: "openai_compat" | "anthropic" | "gemini" | "mock";
  name: string;
  configJson: Record<string, any>;
  hasApiKey: boolean;
  createdAt: string;
};

type OpenAICompatPreset = "openai" | "deepseek" | "custom";

export default function ProvidersPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<Provider["type"]>("openai_compat");
  const [preset, setPreset] = useState<OpenAICompatPreset>("openai");
  const [name, setName] = useState("OpenAI");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [models, setModels] = useState("gpt-4o-mini,gpt-4o");

  const configJson = useMemo(() => {
    if (type === "openai_compat") {
      const list = models
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { baseUrl, models: list };
    }
    return {};
  }, [type, baseUrl, models]);

  useEffect(() => {
    if (type !== "openai_compat") return;
    if (preset === "openai") {
      setName("OpenAI");
      setBaseUrl("https://api.openai.com/v1");
      setModels("gpt-4o-mini,gpt-4o");
    } else if (preset === "deepseek") {
      setName("DeepSeek");
      setBaseUrl("https://api.deepseek.com/v1");
      setModels("deepseek-chat,deepseek-reasoner");
    }
  }, [type, preset]);

  const load = async () => {
    setError(null);
    const res = await apiFetch(`/v1/projects/${projectId}/providers`);
    if (!res.ok) {
      setError(`Failed to load providers (${res.status})`);
      return;
    }
    setProviders(await res.json());
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Providers</h1>
        <p className="mt-1 text-sm text-slate-600">Store model credentials per project (API keys are encrypted at rest).</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Add provider</div>
          <div className="text-sm text-slate-600">MVP supports OpenAI-compatible and Mock.</div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Type</span>
              <select
                className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
                value={type}
                onChange={(e) => setType(e.target.value as Provider["type"])}
              >
                <option value="openai_compat">openai_compat</option>
                <option value="mock">mock</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI / Gateway / Mock" />
            </label>
          </div>

          {type === "openai_compat" ? (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Preset</span>
                  <select
                    className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
                    value={preset}
                    onChange={(e) => setPreset(e.target.value as OpenAICompatPreset)}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Models (comma separated)</span>
                  <Input value={models} onChange={(e) => setModels(e.target.value)} placeholder="deepseek-chat,gpt-4o-mini" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Base URL</span>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">API key</span>
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
              </label>
            </div>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              onClick={async () => {
                setError(null);
                const res = await apiFetch("/v1/providers", {
                  method: "POST",
                  body: JSON.stringify({
                    projectId,
                    type,
                    name,
                    apiKey: apiKey || undefined,
                    configJson
                  })
                });
                if (!res.ok) {
                  setError(`Failed to create provider (${res.status}): ${await res.text().catch(() => "")}`);
                  return;
                }
                setApiKey("");
                await load();
              }}
              disabled={!name.trim() || (type === "openai_compat" && (!baseUrl.trim() || !apiKey.trim()))}
            >
              Add provider
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <Card key={p.id}>
            <CardContent className="grid gap-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="mt-1 text-sm text-slate-600">{p.type}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500 font-mono">{p.id}</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const ok = window.confirm(`Delete provider "${p.name}"?\nAgents using it will be switched to (none / mock).`);
                      if (!ok) return;
                      try {
                        setError(null);
                        const res = await apiFetch(`/v1/providers/${p.id}`, { method: "DELETE" });
                        if (!res.ok && res.status !== 204) {
                          setError(`Failed to delete provider (${res.status}): ${await res.text().catch(() => "")}`);
                          return;
                        }
                        await load();
                      } catch (e: any) {
                        setError(`Failed to delete provider: ${e?.message ? String(e.message) : String(e)}`);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                API key: <span className="font-medium">{p.hasApiKey ? "configured" : "missing"}</span>
              </div>
              {p.type === "openai_compat" ? (
                <div className="text-xs text-slate-500">
                  baseUrl: <span className="font-mono">{String(p.configJson?.baseUrl ?? "")}</span>
                </div>
              ) : null}
              {Array.isArray(p.configJson?.models) ? (
                <div className="text-xs text-slate-500">
                  models:{" "}
                  <span className="font-mono">
                    {p.configJson.models.slice(0, 6).join(", ")}
                    {p.configJson.models.length > 6 ? "…" : ""}
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
