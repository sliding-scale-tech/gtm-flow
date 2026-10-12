"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toCsv } from "@/convex/lib/csv";
import { useToken } from "@/lib/session";
import { LeadDrawer } from "@/components/LeadDrawer";
import { PushModal } from "@/components/PushModal";
import { Badge, Button, Empty, ErrorText, PageHeader, Select, Spinner, errMsg, int, stateTone, usd } from "@/components/ui";

const SEGMENTS = ["residential", "hoa", "commercial", "vacation", "trade_service", "real_estate_sales", "other"];
const STATES = ["queued", "working", "done", "rejected", "duplicate", "error", "blocked"];
const EMAIL_STATUS = ["valid", "catch_all", "risky", "invalid"];

type Row = {
  _id: Id<"leads">; name: string; category: string; phone: string; county: string; usState: string; mapsUrl: string; domain?: string;
  classify?: { segment: string }; owner?: { fullName: string; firstName: string; lastName: string; title: string; linkedinUrl: string };
  decision?: { decision: string }; email?: string; emailSource?: string; emailStatus?: string; state: string; rejectReason?: string; lastError?: string;
  personal?: { reviewLine: string; description: string; genericLine: string; finalLine: string }; vars?: Record<string, string>; costUsd: number;
};

// Export = what you need to run a campaign, in a sensible order. Debug columns (status, reject reason) are added only
// when exporting rows that are NOT all usable emails.
const OUTREACH_COLS = ["company", "first_name", "last_name", "job_title", "email", "email_status", "phone", "website", "linkedin_url", "county", "state",
  "final_line", "review_line", "description", "generic_line"];
const isUsable = (l: Row) => !!l.email && (l.emailStatus === "valid" || l.emailStatus === "catch_all");

function flatten(l: Row): Record<string, unknown> {
  return {
    company: l.name, first_name: l.owner?.firstName, last_name: l.owner?.lastName, job_title: l.owner?.title,
    email: l.email, email_status: l.emailStatus, phone: l.phone, website: l.domain, linkedin_url: l.owner?.linkedinUrl,
    county: l.county, state: l.usState,
    final_line: l.personal?.finalLine, review_line: l.personal?.reviewLine, description: l.personal?.description, generic_line: l.personal?.genericLine,
    ...Object.fromEntries(Object.entries(l.vars ?? {}).map(([k, v]) => [`vars.${k}`, v])),
    lead_status: l.state, reject_reason: l.rejectReason,
  };
}

function LeadsInner() {
  const token = useToken();
  const convex = useConvex();
  const router = useRouter();
  const sp = useSearchParams();
  const runParam = sp.get("run");
  const runId = (runParam || undefined) as Id<"runs"> | undefined;
  const [state, setState] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [segment, setSegment] = useState("");
  const [open, setOpen] = useState<Id<"leads"> | null>(null);
  const [push, setPush] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [usableOnly, setUsableOnly] = useState(true);
  const [err, setErr] = useState("");

  const runs = useQuery(api.runs.list, { token });
  const filters = { ...(runId && { runId }), ...(state && { state }), ...(emailStatus && { emailStatus }), ...(segment && { segment }) };
  const { results, status, loadMore, isLoading } = usePaginatedQuery(api.leads.page, { token, ...filters }, { initialNumItems: 100 });

  function setRun(v: string) { router.replace(v ? `/leads?run=${v}` : "/leads"); }

  async function exportCsv() {
    setErr(""); setExporting(true);
    try {
      const rows: Record<string, unknown>[] = [];
      let cursor: string | null = null;
      for (;;) {
        // Usable emails only exist on finished ("done") leads, so ask the server for just those.
        const r: { page: Row[]; isDone: boolean; continueCursor: string } = await convex.query(api.leads.page, { token, ...filters, ...(usableOnly && { state: "done" }), paginationOpts: { numItems: 500, cursor } }) as never;
        rows.push(...r.page.filter((l) => !usableOnly || isUsable(l)).map(flatten));
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      if (!rows.length) { setErr(usableOnly ? "No usable emails (valid / catch-all) in this selection yet." : "Nothing to export for this selection."); return; }
      const cols = [...OUTREACH_COLS, ...[...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k.startsWith("vars."))))], ...(usableOnly ? [] : ["lead_status", "reject_reason"])];
      const blob = new Blob(["﻿" + toCsv(rows, cols)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${usableOnly ? "usable-emails" : "leads"}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(errMsg(e)); }
    finally { setExporting(false); }
  }

  const th = "sticky top-0 z-10 whitespace-nowrap border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-500";
  const td = "px-3 py-1.5 align-top";
  const rows = results as unknown as Row[];

  return (
    <div>
      <PageHeader title="Leads" sub={`${int(rows.length)} loaded${status === "CanLoadMore" ? "+" : ""}`}
        actions={<>
          <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300" title="Only leads with a valid or catch-all email">
            <input type="checkbox" className="accent-emerald-500" checked={usableOnly} onChange={(e) => setUsableOnly(e.target.checked)} />Usable emails only
          </label>
          <Button size="sm" loading={exporting} onClick={exportCsv}>Export CSV</Button>
          <Button size="sm" variant="primary" onClick={() => setPush(true)}>Push to Instantly</Button>
        </>} />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={runParam ?? ""} onChange={(e) => setRun(e.target.value)}>
          <option value="">All runs</option>
          {runs?.map((r) => <option key={r._id} value={r._id}>{r.fileName} · {new Date(r._creationTime).toLocaleDateString()}</option>)}
        </Select>
        <Select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Any state</option>{STATES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select value={emailStatus} onChange={(e) => setEmailStatus(e.target.value)}>
          <option value="">Any email status</option>{EMAIL_STATUS.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select value={segment} onChange={(e) => setSegment(e.target.value)}>
          <option value="">Any segment</option>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      <ErrorText>{err}</ErrorText>

      <div className="max-h-[calc(100vh-14rem)] overflow-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[1200px] border-collapse text-xs">
          <thead>
            <tr>
              {["Company", "Domain", "Segment", "Owner", "Email", "Decision", "State", "Final line", "Cost"].map((h) => <th key={h} className={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map((l) => (
              <tr key={l._id} onClick={() => setOpen(l._id)} className="cursor-pointer hover:bg-zinc-900/70">
                <td className={`${td} max-w-64`}>
                  <div className="truncate font-medium text-zinc-100">{l.name}</div>
                  <div className="truncate text-zinc-500">{l.category} · {l.county}, {l.usState}</div>
                </td>
                <td className={`${td} max-w-44 truncate text-zinc-300`}>{l.domain ?? "—"}</td>
                <td className={td}>{l.classify ? <Badge>{l.classify.segment}</Badge> : "—"}</td>
                <td className={`${td} max-w-48`}>
                  <div className="truncate text-zinc-200">{l.owner?.fullName || "—"}</div>
                  <div className="truncate text-zinc-500">{l.owner?.title}</div>
                </td>
                <td className={`${td} max-w-56`}>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-zinc-200">{l.email ?? "—"}</span>
                    {l.emailStatus && <Badge tone={stateTone[l.emailStatus]}>{l.emailStatus}</Badge>}
                  </div>
                  {l.emailSource && <div className="text-zinc-500">{l.emailSource}</div>}
                </td>
                <td className={`${td} whitespace-nowrap text-zinc-300`}>{l.decision?.decision ?? "—"}</td>
                <td className={td}>
                  <Badge tone={stateTone[l.state]} title={l.state === "error" ? l.lastError : undefined}>{l.state}</Badge>
                  {l.state === "rejected" && <div className="mt-0.5 max-w-40 truncate text-zinc-500" title={l.rejectReason}>{l.rejectReason}</div>}
                  {l.state === "error" && <div className="mt-0.5 max-w-40 truncate text-amber-300/80" title={l.lastError}>{l.lastError}</div>}
                </td>
                <td className={`${td} max-w-72`}><div className="truncate text-zinc-400" title={l.personal?.finalLine}>{l.personal?.finalLine || "—"}</div></td>
                <td className={`${td} tabular whitespace-nowrap text-zinc-400`}>{usd(l.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {status === "LoadingFirstPage" && <div className="p-6 text-center"><Spinner /></div>}
        {status !== "LoadingFirstPage" && rows.length === 0 && <Empty>No leads match these filters.</Empty>}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>{int(rows.length)} loaded</span>
        {status === "CanLoadMore" && <Button size="sm" onClick={() => loadMore(100)}>Load more</Button>}
        {(status === "LoadingMore" || isLoading) && status !== "LoadingFirstPage" && <Spinner />}
        {status === "Exhausted" && <span>All loaded</span>}
      </div>

      {open && <LeadDrawer leadId={open} onClose={() => setOpen(null)} />}
      {push && <PushModal runId={runId} onClose={() => setPush(false)} />}
    </div>
  );
}

export default function LeadsPage() {
  return <Suspense fallback={<Spinner />}><LeadsInner /></Suspense>;
}
