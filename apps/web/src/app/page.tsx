import Link from "next/link";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";

export default function HomePage() {
  return (
    <main className="grid gap-6">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold">Build, run, and observe agents</h1>
          <p className="mt-1 text-sm text-slate-600">
            Create projects, define agents, and start runs with real-time streaming events.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            Quick start: create a Project → create an Agent → start a Run.
          </div>
          <div className="flex items-center gap-2">
            <Link href="/register">
              <Button variant="secondary">Register</Button>
            </Link>
            <Link href="/projects">
              <Button>Go to Projects</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Projects", desc: "Organize agents and runs by workspace.", href: "/projects" },
          { title: "Agents", desc: "Browse agents and jump into chats.", href: "/agents" },
          { title: "Skills", desc: "Browse server-provided skills.", href: "/skills" }
        ].map((x) => (
          <Card key={x.title}>
            <CardContent>
              <div className="text-sm font-semibold">{x.title}</div>
              <div className="mt-1 text-sm text-slate-600">{x.desc}</div>
              <div className="mt-3">
                <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href={x.href}>
                  Open
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
