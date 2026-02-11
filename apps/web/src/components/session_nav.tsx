"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { clearTokens, getTokens } from "../lib/auth";
import { Button } from "./ui/button";

type Me = {
  id: string;
  email: string;
  fullName: string | null;
  avatarSvg: string | null;
  supervisorAgentId?: string | null;
  guardianAgentId?: string | null;
};

export function SessionNav() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const tokens = getTokens();
        if (!tokens?.accessToken) {
          if (!cancelled) setMe(null);
          return;
        }
        const res = await apiFetch("/v1/auth/me");
        if (!res.ok) {
          if (!cancelled) setMe(null);
          return;
        }
        const data = (await res.json()) as Me;
        if (!cancelled) setMe(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    const onAuth = () => {
      if (cancelled) return;
      setLoading(true);
      void load();
    };
    window.addEventListener("pagent_auth_change", onAuth);
    return () => {
      cancelled = true;
      window.removeEventListener("pagent_auth_change", onAuth);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">…</span>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex items-center gap-2">
        <Link className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/login">
          Login
        </Link>
        <Link className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/register">
          Register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {me.supervisorAgentId ? (
        <Link className="hidden sm:block rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href={`/agents/${me.supervisorAgentId}/chat`}>
          Supervisor
        </Link>
      ) : null}
      {me.guardianAgentId ? (
        <Link className="hidden sm:block rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href={`/agents/${me.guardianAgentId}/chat`}>
          Guardian
        </Link>
      ) : null}
      <Link className="hidden sm:flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-100" href="/me">
        <div
          className="h-8 w-8 rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: me.avatarSvg ?? "" }}
        />
        <div className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{me.fullName || me.email}</span>
        </div>
      </Link>
      <Link className="sm:hidden rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/me">
        Me
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          try {
            const tokens = getTokens();
            await apiFetch("/v1/auth/logout", {
              method: "POST",
              body: JSON.stringify({ refreshToken: tokens?.refreshToken })
            }).catch(() => {});
          } finally {
            clearTokens();
            window.location.href = "/login";
          }
        }}
      >
        Logout
      </Button>
    </div>
  );
}
