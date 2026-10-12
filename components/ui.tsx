"use client";
// Shared UI primitives. Plain Tailwind, dark theme (zinc base, emerald accent).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ConvexError } from "convex/values";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function errMsg(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^\[CONVEX [^\]]+\]\s*/, "").replace(/\[Request ID: [^\]]+\]\s*/, "").replace(/^(Server Error\s*)?Uncaught (ConvexError|Error):\s*/, "").split("\n")[0];
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const btn: Record<Variant, string> = {
  primary: "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold",
  secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700",
  ghost: "text-zinc-300 hover:bg-zinc-800/70",
  danger: "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30",
};
export function Button({ variant = "secondary", size = "md", loading, className, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-emerald-400",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm", btn[variant], className)}>
      {loading && <Spinner />}{children}
    </button>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <span className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-hidden />
);

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-zinc-800 bg-zinc-900/50", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={cx("tabular mt-1 text-2xl font-semibold", tone === "good" && "text-emerald-400", tone === "warn" && "text-amber-300", tone === "bad" && "text-rose-300")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

const tones = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  blue: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  zinc: "bg-zinc-800 text-zinc-300 border-zinc-700",
};
export type Tone = keyof typeof tones;
export const Badge = ({ tone = "zinc", children, title }: { tone?: Tone; children: ReactNode; title?: string }) => (
  <span title={title} className={cx("inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>
);

/** Consistent colors for lead/run/email states everywhere. */
export const stateTone: Record<string, Tone> = {
  queued: "zinc", working: "blue", done: "green", rejected: "red", duplicate: "violet", error: "amber", blocked: "amber",
  running: "blue", paused: "amber", stopped: "zinc", ingesting: "blue",
  valid: "green", catch_all: "amber", risky: "amber", invalid: "red",
};

const field = "h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none";
// Full width unless the caller sets its own width (w-*), since both classes can't be overridden by order.
const width = (c?: string) => (/(^|\s)w-/.test(c ?? "") ? "" : "w-full");
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, width(className), className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, width(className), "pr-8", className)}>{children}</select>;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea {...p} className={cx(field, width(className), "h-auto min-h-24 py-2 font-mono text-xs leading-relaxed", className)} />;

export const Label = ({ children, hint }: { children: ReactNode; hint?: ReactNode }) => (
  <label className="mb-1 block text-xs font-medium text-zinc-400">{children}{hint && <span className="ml-1 font-normal text-zinc-600">{hint}</span>}</label>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="py-10 text-center text-sm text-zinc-500">{children}</div>;
export const ErrorText = ({ children }: { children: ReactNode }) => children ? <p className="text-sm text-rose-300">{children}</p> : null;

export const PageHeader = ({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div><h1 className="text-xl font-semibold text-zinc-50">{title}</h1>{sub && <p className="mt-1 text-sm text-zinc-500">{sub}</p>}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const usd = (n: number | undefined) => `$${(n ?? 0).toFixed((n ?? 0) < 10 ? 3 : 2)}`;
export const int = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
export const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(ms).toLocaleDateString();
};
