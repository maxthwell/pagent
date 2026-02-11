import type { ReactNode } from "react";
import "./globals.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import Link from "next/link";
import { SessionNav } from "../components/session_nav";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
        <div className="mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-8 py-6">
          <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-semibold">
                p
              </div>
              <div>
                <div className="text-sm text-slate-500">AI Agent Console</div>
                <div className="text-lg font-semibold leading-tight">pagent</div>
              </div>
            </div>
            <nav className="flex items-center gap-2">
              <Link className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/projects">
                Projects
              </Link>
              <Link className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/agents">
                Agents
              </Link>
              <Link className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/groups">
                Groups
              </Link>
              <Link className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/tools">
                Tools
              </Link>
              <Link className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href="/skills">
                Skills
              </Link>
              <SessionNav />
            </nav>
          </header>
          {children}
          <footer className="mt-10 text-xs text-slate-500">
            <span className="font-mono">/docs</span> (API docs) · <span className="font-mono">/healthz</span> (health)
          </footer>
        </div>
      </body>
    </html>
  );
}
