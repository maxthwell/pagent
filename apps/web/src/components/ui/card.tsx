import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl bg-white shadow-soft ring-1 ring-slate-200/60", className)}>{children}</div>;
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-6 pt-6 pb-4 border-b border-slate-100", className)}>{children}</div>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-6 py-5", className)}>{children}</div>;
}

