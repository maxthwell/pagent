"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setTokens } from "../../lib/auth";
import { apiFetch } from "../../lib/api";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="grid place-items-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-semibold">Create account</h1>
          <p className="mt-1 text-sm text-slate-600">Register to start building agents.</p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              const res = await apiFetch(`/v1/auth/register`, {
                method: "POST",
                body: JSON.stringify({ email, password })
              });
              if (!res.ok) {
                setError("Register failed");
                return;
              }
              const tokens = await res.json();
              setTokens(tokens);
              router.push("/projects");
            }}
            className="grid gap-3"
          >
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Email</span>
              <Input placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Password</span>
              <Input
                placeholder="min 8 characters"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button type="submit">Register</Button>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <p className="text-sm text-slate-600">
              Already have an account?{" "}
              <Link className="font-medium text-slate-900 underline underline-offset-4" href="/login">
                Login
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
