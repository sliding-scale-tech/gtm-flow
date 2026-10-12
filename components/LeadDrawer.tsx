"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToken } from "@/lib/session";
import { Badge, Button, ErrorText, Input, Select, Spinner, cx, errMsg, stateTone, usd } from "@/components/ui";
import { EnrichmentGrid } from "@/components/EnrichmentGrid";
import { STAGES } from "@/convex/lib/stageList";

const STAGE_OPTS: readonly string[] = STAGES;
const safeUrl = (u?: string) => (u && u.startsWith("https://") ? u : null);
const safeDomain = (d?: string) => (d && /^[a-z0-9.-]+$/i.test(d) ? d : null);

function Ext({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{children}</a>;
}

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => {}); }}>
      {ok ? "Copied" : "Copy"}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-zinc-800 px-5 py-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, children, copy }: { k: string; children: ReactNode; copy?: string }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <div className="w-32 shrink-0 text-zinc-500">{k}</div>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-zinc-200">{children || <span className="text-zinc-600">—</span>}</div>
      {copy ? <Copy text={copy} /> : null}
    </div>
  );
}

function Fold({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" className="text-xs text-zinc-400 hover:text-zinc-100" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {title} ({text.length.toLocaleString()} chars)
      </button>
      {open && <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{text || "(empty)"}</pre>}
    </div>
  );
}

export function LeadDrawer({ leadId, onClose }: { leadId: Id<"leads">; onClose: () => void }) {
  const token = useToken();
  const data = useQuery(api.leads.detail, { token, leadId });
  const override = useMutation(api.leads.override);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState("research");
  const [tab, setTab] = useState<"grid" | "details">("grid");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function act(action: "go" | "reject" | "rerun") {
    setErr(""); setBusy(action);
    try { await override({ token, leadId, action, stage: action === "rerun" ? stage : undefined, note: note.trim() || undefined }); setNote(""); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(""); }
  }

  const l = data?.lead;
  const domain = safeDomain(l?.domain);
  const vars = Object.entries(l?.vars ?? {});

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" className="relative flex h-full w-[min(720px,100vw)] flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        {data === undefined && <div className="p-8"><Spinner /></div>}
        {data === null && <div className="p-8 text-sm text-zinc-400">Lead not found. <Button size="sm" onClick={onClose}>Close</Button></div>}
        {data && l && (
          <>
            <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-zinc-50">{l.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={stateTone[l.state]}>{l.state}</Badge>
                    <span className="text-zinc-500">stage: {l.stage}</span>
                    <Ext href={safeUrl(l.mapsUrl)}>Google Maps ↗</Ext>
                    {domain && <Ext href={`https://${domain}`}>{domain} ↗</Ext>}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                    <span className="font-mono">{l._id}</span><Copy text={l._id} />
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
              </div>
              {l.state === "rejected" && <p className="mt-2 text-xs text-rose-300">Rejected: {l.rejectReason}</p>}
              {l.state === "duplicate" && <p className="mt-2 text-xs text-violet-300">Duplicate of {data.duplicateOfName ?? "another lead"}</p>}
              {l.lastError && <p className="mt-2 text-xs text-amber-300">Last error: {l.lastError}</p>}
              {l.note && <p className="mt-2 text-xs text-zinc-400">Note: {l.note}</p>}
            </header>

            <Section title="Actions">
              <div className="flex flex-col gap-2">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional note" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="primary" loading={busy === "go"} disabled={!!busy} onClick={() => act("go")}>Force go (find email)</Button>
                  <Button size="sm" variant="danger" loading={busy === "reject"} disabled={!!busy} onClick={() => act("reject")}>Reject</Button>
                  <Select className="!h-8 !w-36 text-xs" value={stage} onChange={(e) => setStage(e.target.value)}>
                    {STAGE_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <Button size="sm" loading={busy === "rerun"} disabled={!!busy} onClick={() => act("rerun")}>Re-run stage</Button>
                </div>
                <ErrorText>{err}</ErrorText>
              </div>
            </Section>

            <div className="flex gap-1 border-b border-zinc-800 px-5 pt-3">
              {([["grid", "Enrichment grid (44 columns)"], ["details", "Details & steps"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)}
                  className={cx("-mb-px rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium", tab === k ? "border-emerald-400 text-zinc-50" : "border-transparent text-zinc-500 hover:text-zinc-200")}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "grid" && (
              <div className="px-5 py-4">
                <EnrichmentGrid lead={l} logs={data.logs} named={data.named} onCopy={(t) => <Copy text={t} />} />
              </div>
            )}

            {tab === "details" && (<>
            <Section title="Company">
              <Row k="Category">{l.category}</Row>
              <Row k="Phone">{l.phone}</Row>
              <Row k="Location">{[l.county, l.usState].filter(Boolean).join(", ")}</Row>
              <Row k="Rating">{l.rating != null ? `${l.rating} (${l.reviewsCount ?? 0} reviews)` : ""}</Row>
              <Row k="Domain">{l.domain ? `${l.domain}${l.domainSource ? ` (via ${l.domainSource})` : ""}` : ""}</Row>
              <Row k="Website read">{l.siteOk == null ? "" : l.siteOk ? "ok" : "failed / empty"}</Row>
            </Section>

            <Section title="Classification">
              {l.classify ? (<>
                <Row k="Segment">{l.classify.segment}</Row>
                <Row k="Property manager?">{String(l.classify.isPropertyManager)}</Row>
                <Row k="Independent?">{String(l.classify.isIndependent)}</Row>
                <Row k="Size">{String(l.classify.estSize ?? "")}</Row>
                <Row k="Confidence">{String(l.classify.confidence)}</Row>
                <Row k="Reasoning">{l.classify.reasoning}</Row>
              </>) : <p className="text-sm text-zinc-600">Not classified yet.</p>}
            </Section>

            <Section title="Owner">
              {l.owner ? (<>
                <Row k="Name" copy={l.owner.fullName}>{l.owner.fullName}</Row>
                <Row k="Title">{l.owner.title}</Row>
                <Row k="LinkedIn">{safeUrl(l.owner.linkedinUrl) ? <Ext href={safeUrl(l.owner.linkedinUrl)}>{l.owner.linkedinUrl}</Ext> : ""}</Row>
                <Row k="Source">{safeUrl(l.owner.sourceUrl) ? <Ext href={safeUrl(l.owner.sourceUrl)}>{l.owner.sourceUrl}</Ext> : l.owner.sourceUrl}</Row>
                <Row k="Confidence">{String(l.owner.confidence)}</Row>
              </>) : <p className="text-sm text-zinc-600">No owner found yet.</p>}
            </Section>

            <Section title="Decision">
              {l.decision ? (<>
                <Row k="Decision">{l.decision.decision}</Row>
                <Row k="Reasons">{l.decision.reasons.join("\n")}</Row>
                <Row k="Failed gates">{l.decision.failedGates.join(", ")}</Row>
              </>) : <p className="text-sm text-zinc-600">No decision yet.</p>}
            </Section>

            <Section title="Email">
              <Row k="Address" copy={l.email}>{l.email}</Row>
              <Row k="Status">{l.emailStatus ? <Badge tone={stateTone[l.emailStatus]}>{l.emailStatus}</Badge> : ""}</Row>
              <Row k="Source">{l.emailSource}</Row>
              <Row k="Pushed to Instantly">{l.pushedAt ? new Date(l.pushedAt).toLocaleString() : ""}</Row>
            </Section>

            <Section title="Personalization">
              {l.personal ? (<>
                <Row k="Review line" copy={l.personal.reviewLine}>{l.personal.reviewLine}</Row>
                <Row k="Description" copy={l.personal.description}>{l.personal.description}</Row>
                <Row k="Service label" copy={l.personal.serviceLabel}>{l.personal.serviceLabel}</Row>
                <Row k="Generic line" copy={l.personal.genericLine}>{l.personal.genericLine}</Row>
                <Row k="Final line" copy={l.personal.finalLine}>{l.personal.finalLine}</Row>
                {vars.map(([k, v]) => <Row key={k} k={k} copy={String(v)}>{String(v)}</Row>)}
              </>) : <p className="text-sm text-zinc-600">Not personalized yet.</p>}
            </Section>

            <Section title={`Step timeline · ${usd(l.costUsd)}`}>
              {data.logs.length === 0 && <p className="text-sm text-zinc-600">No steps yet.</p>}
              <ol className="space-y-2">
                {data.logs.map((s) => (
                  <li key={s._id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={cx("size-2 rounded-full", s.ok ? "bg-emerald-400" : "bg-rose-400")} />
                      <span className="font-medium text-zinc-100">{s.stage}</span>
                      <span className="ml-auto tabular text-zinc-500">{s.ms}ms · {usd(s.costUsd)}</span>
                    </div>
                    {s.summary && <div className="mt-1 whitespace-pre-wrap break-words text-zinc-400">{s.summary}</div>}
                    {s.error && <div className="mt-1 whitespace-pre-wrap break-words text-rose-300">{s.error}</div>}
                  </li>
                ))}
              </ol>
              <Fold title="Website text" text={data.siteText} />
              <Fold title="Owner evidence" text={data.evidence} />
            </Section>
            </>)}
          </>
        )}
      </aside>
    </div>
  );
}
