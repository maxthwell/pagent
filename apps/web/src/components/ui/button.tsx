import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ className, variant = "primary", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition focus:outline-none focus:ring-2 focus:ring-slate-400/40 disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-9 px-3 text-sm" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-800",
        variant === "secondary" && "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50",
        variant === "ghost" && "bg-transparent text-slate-900 ring-1 ring-transparent hover:bg-slate-100 hover:ring-slate-200",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-500",
        className
      )}
      {...props}
    />
  );
}
