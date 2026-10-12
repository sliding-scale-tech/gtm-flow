"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToken } from "@/lib/session";
import { Funnel } from "@/components/Funnel";
import { Badge, Button, Card, Empty, ErrorText, Input, PageHeader, Spinner, Stat, errMsg, int, stateTone, usd } from "@/components/ui";

const WHY: Record<string, string> = {
  category: "Wrong category (trades etc.)", chain: "National chain", no_domain: "No website found", site_unreadable: "Website unreadable",
  not_icp: "Not a residential/HOA/commercial PM", not_independent: "Not independent", no_owner: "No owner found", gate: "Failed hard gates",
  agent_skip: "Agent said skip", building_only: "Building site, no manager named", building_unclear: "Building, operator unclear", agent_error: "Research agent failed", no_email: "No email found", invalid_email: "Email invalid", closed: "Closed business", no_name: "No name", duplicate: "Duplicate",
};

export default function RunPage() {
  const token = useToken();
  const { id } = useParams<{ id: string }>();
  const runId = id as Id<"runs">;
  const run = useQuery(api.runs.get, { token, runId });
  const control = useMutation(api.runs.control);
  const retryFailed = useMutation(api.runs.retryFailed);
  const [retryNote, setRetryNote] = useState("");
  const [budget, setBudget] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (run === undefined) return <div className="p-10"><Spinner /></div>;
  if (run === null) return <Empty>Run not found.</Empty>;

  const act = async (action: "pause" | "resume" | "stop") => {
    if (action === "stop" && !window.confirm("Stop this run?")) return;
    setBusy(true); setErr("");
    try {
      const b = budget !== "" ? Number(budget) : undefined;
      await control({ token, runId, action, budgetUsd: action === "resume" ? b : undefined });
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const retry = async () => {
    setBusy(true); setErr(""); setRetryNote("");
    try {
      const r = await retryFailed({ token, runId });
      setRetryNote(r.retried ? `Retrying ${int(r.retried)} failed lead${r.retried === 1 ? "" : "s"}; the run is running again.${r.left ? ` ${int(r.left)} more failed: press ↻ again.` : ""}` : "No failed leads to retry.");
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const c = run.counts;
  const usable = (c["email:valid"] ?? 0) + (c["email:catch_all"] ?? 0);
  const drops = Object.entries(c).filter(([k]) => k.startsWith("rej:")).map(([k, n]) => [k.slice(4), n] as const).sort((a, b) => b[1] - a[1]);
  const spentPct = run.budgetUsd ? Math.min(100, (run.spentUsd / run.budgetUsd) * 100) : 0;
  const canResume = ["paused", "stopped", "done"].includes(run.status);

  // Overall progress, from counters the pipeline already keeps (no extra query): finished = ready + rejected + duplicate + error.
  const total = c.rows ?? 0;
  const rejected = drops.reduce((n, [, k]) => n + k, 0);
  const finished = (c.ready ?? 0) + rejected + (c.dup ?? 0) + (c.error ?? 0);
  const left = Math.max(0, total - finished);
  const donePct = total ? Math.min(100, (finished / total) * 100) : 0;
  // ETA only counts leads that needed real work (rows dropped by free cleaning at import are instant and would skew it).
  const instant = ["category", "chain", "closed", "no_name"].reduce((n, k) => n + (c[`rej:${k}`] ?? 0), 0);
  const worked = finished - instant;
  const etaMin = run.status === "running" && worked >= 5 && left > 0 ? Math.max(1, Math.round((Date.now() - run.startedAt) / 60000 / worked * left)) : null;

  return (
    <div className="space-y-4">
      <PageHeader title={run.fileName} sub={<span className="inline-flex items-center gap-2"><Badge tone={stateTone[run.status]}>{run.status}</Badge>{run.source}</span>}
        actions={<Link href={`/leads?run=${run._id}`}><Button>View leads</Button></Link>} />
      {run.status === "paused" && run.pauseReason && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">Paused: {run.pauseReason}</div>}
      {run.status === "error" && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">Error: {run.error ?? "Unknown error"}</div>}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {run.status === "running" && <Button onClick={() => act("pause")} loading={busy}>Pause</Button>}
          {canResume && (
            <>
              <Input type="number" min="0" step="0.5" placeholder={`Budget (${run.budgetUsd})`} value={budget} onChange={(e) => setBudget(e.target.value)} className="w-36" />
              <Button variant="primary" onClick={() => act("resume")} loading={busy}>Resume</Button>
            </>
          )}
          {["running", "paused", "ingesting"].includes(run.status) && <Button variant="danger" onClick={() => act("stop")} disabled={busy}>Stop</Button>}
        </div>
        <div className="mt-2"><ErrorText>{err}</ErrorText></div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-zinc-400">
            <span>{run.status === "ingesting" ? "Importing file…" : <>Progress <span className="tabular text-zinc-200">{int(finished)}</span> of {int(total)} done · <span className="tabular text-zinc-200">{int(left)}</span> left{etaMin ? ` · ~${etaMin} min` : ""}</>}</span>
            <span>{Math.round(donePct)}%</span>
          </div>
          <div className="mt-1 h-2 rounded bg-zinc-800"><div className="h-full rounded bg-sky-500 transition-all" style={{ width: `${donePct}%` }} /></div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-zinc-500">
            <span>ready {int(c.ready)}</span><span>rejected {int(rejected)}</span><span>duplicate {int(c.dup)}</span><span>error {int(c.error)}</span>
            {left > 0 && run.status === "paused" && <span className="text-amber-300">{int(left)} waiting (see the pause reason above)</span>}
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-zinc-400"><span>Spent {usd(run.spentUsd)} of {usd(run.budgetUsd)}</span><span>{Math.round(spentPct)}%</span></div>
          <div className="mt-1 h-2 rounded bg-zinc-800"><div className={spentPct >= 90 ? "h-full rounded bg-amber-400" : "h-full rounded bg-emerald-500"} style={{ width: `${spentPct}%` }} /></div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
            {Object.entries(run.costs).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k}>{k} <span className="tabular text-zinc-200">{usd(v)}</span></span>)}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Rows" value={int(c.rows ?? run.rowsTotal)} />
        <Stat label="Usable emails" value={int(usable)} tone="good" hint={`${int(c["email:valid"])} valid · ${int(c["email:catch_all"])} catch-all`} />
        <Stat label="Ready" value={int(c.ready)} />
        <Stat label="Cost per usable email" value={usable ? usd(run.spentUsd / usable) : "—"} />
      </div>

      <Card title="Funnel"><Funnel counts={c} rows={c.rows ?? run.rowsTotal} /></Card>

      <Card title="Why leads dropped">
        {drops.length === 0 && !c.dup && !c.error ? <Empty>No drops yet.</Empty> : (
          <ul className="divide-y divide-zinc-800 text-sm">
            {drops.map(([k, n]) => <li key={k} className="flex justify-between py-1.5"><span className="text-zinc-300">{WHY[k] ?? k}</span><span className="tabular text-zinc-400">{int(n)}</span></li>)}
            {!!c.dup && <li className="flex justify-between py-1.5"><span className="text-zinc-300">Duplicates</span><span className="tabular text-zinc-400">{int(c.dup)}</span></li>}
            {!!c.error && <li className="flex justify-between py-1.5">
              <span className="flex items-center gap-2 text-rose-300">Failed 3x (error)
                <button type="button" onClick={retry} disabled={busy} title="Retry all failed leads (starts the run again)" aria-label="Retry failed leads"
                  className="rounded border border-zinc-700 px-1.5 text-sm leading-5 text-zinc-300 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50">↻</button>
              </span>
              <span className="tabular text-zinc-400">{int(c.error)}</span></li>}
            {retryNote && <li className="py-1.5 text-xs text-zinc-400">{retryNote}</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}
