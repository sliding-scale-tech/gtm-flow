"use client";
import { int, pct } from "@/components/ui";

// "a|b" = use counter a, fall back to b (b = key used by runs before the research agent existed).
const STEPS: [string, string][] = [
  ["Rows", "rows"], ["Cleaned", "in:domain"], ["Domain found", "in:site"], ["Website read", "site_ok|in:classify"],
  ["ICP fit", "icp|in:owner"], ["Owner found", "owner|in:decide"], ["Go decision", "in:find_email"],
  ["Email found", "email_found|in:verify"], ["Usable email", "in:personalize"], ["Ready", "ready"],
];

export function Funnel({ counts, rows }: { counts: Record<string, number>; rows: number }) {
  const base = rows || counts.rows || 0;
  const val = (key: string) => {
    if (key === "rows") return base;
    const [a, b] = key.split("|");
    return counts[a] ?? (b ? counts[b] : undefined) ?? 0;
  };
  return (
    <div className="space-y-1.5">
      {STEPS.map(([label, key], i) => {
        const n = val(key);
        const prev = i === 0 ? 0 : val(STEPS[i - 1][1]);
        const w = base ? Math.max((n / base) * 100, n > 0 ? 1.5 : 0) : 0;
        return (
          <div key={key} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-xs sm:grid-cols-[130px_1fr_200px]">
            <span className="text-zinc-400">{label}</span>
            <div className="h-5 overflow-hidden rounded bg-zinc-800/60">
              <div className="h-full rounded bg-gradient-to-r from-emerald-700 to-emerald-400 transition-all duration-500" style={{ width: `${w}%` }} />
            </div>
            <span className="tabular text-right text-zinc-300">
              {int(n)} <span className="text-zinc-500">{pct(n, base)}</span>
              {i > 0 && <span className="hidden text-zinc-600 sm:inline"> · {pct(n, prev)} of prev</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
