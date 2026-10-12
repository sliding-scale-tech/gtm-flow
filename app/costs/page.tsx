"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { buildModel, PROVIDER_LABEL, type RunLite, type ScanFile } from "@/convex/lib/costModel";
import { useToken } from "@/lib/session";
import { Badge, Button, Card, ErrorText, Input, Label, PageHeader, Spinner, errMsg, int } from "@/components/ui";

type Report = {
  at: number; prices: Record<string, number>; runs: RunLite[];
  scan: null | { status: "running" | "done" | "error"; startedAt: number; finishedAt?: number; total: number; done: number; files: ScanFile[]; error?: string };
};

const CACHE = "gtm_costs_report";
const PROV_BG: Record<string, string> = { exa: "bg-sky-500", gemini: "bg-violet-500", findymail: "bg-amber-500", trykitt: "bg-teal-500", bouncer: "bg-pink-500", instantly: "bg-zinc-500", aiark: "bg-zinc-600" };

const money = (x: number) => { const a = Math.abs(x); return "$" + (a >= 100 ? Math.round(x).toLocaleString("en-US") : a >= 1 ? x.toFixed(2) : x.toFixed(3)); };
const pct = (x: number) => (x * 100 < 10 ? (x * 100).toFixed(1) : Math.round(x * 100)) + "%";
const niceCeil = (x: number) => { if (x <= 0) return 1; const p = 10 ** Math.floor(Math.log10(x)), m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };

function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label="Explain" className="ml-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-600 text-[10px] font-semibold text-zinc-400 hover:border-emerald-400 hover:text-emerald-300 focus:border-emerald-400 focus:outline-none">i</button>
      <span role="tooltip" className="pointer-events-none invisible absolute left-1/2 top-6 z-30 w-64 max-w-[75vw] -translate-x-1/2 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-normal normal-case leading-snug tracking-normal text-zinc-900 opacity-0 shadow-lg group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">{text}</span>
    </span>
  );
}

function Kpi({ label, value, hint, tip }: { label: string; value: ReactNode; hint?: ReactNode; tip: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center text-xs uppercase tracking-wide text-zinc-500">{label}<Tip text={tip} /></div>
      <div className="tabular mt-1 text-2xl font-semibold text-zinc-50">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

type BarItem = { label: string; value: number; text: ReactNode; color?: string; tip?: string };
function Bars({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[minmax(90px,150px)_1fr_auto] items-center gap-3">
          <div className="flex min-w-0 items-center text-xs text-zinc-300"><span className="break-words">{i.label}</span>{i.tip && <Tip text={i.tip} />}</div>
          <div className="h-4 rounded bg-zinc-800"><div className={`h-full min-w-[2px] rounded ${i.color ?? "bg-emerald-500"}`} style={{ width: `${(i.value / max) * 100}%` }} /></div>
          <div className="tabular whitespace-nowrap text-right text-xs text-zinc-200">{i.text}</div>
        </div>
      ))}
    </div>
  );
}

const Th = ({ children, r }: { children?: ReactNode; r?: boolean }) => <th className={`whitespace-nowrap border-b border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-500 ${r ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, r, wrap }: { children?: ReactNode; r?: boolean; wrap?: boolean }) => <td className={`border-b border-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 ${r ? "tabular text-right" : ""} ${wrap ? "min-w-[220px]" : "whitespace-nowrap"}`}>{children}</td>;
const Table = ({ children }: { children: ReactNode }) => <div className="overflow-x-auto"><table className="w-full border-collapse">{children}</table></div>;
const Source = ({ children }: { children: ReactNode }) => <p className="mt-2 text-xs text-zinc-500"><span className="text-zinc-400">Source:</span> {children}</p>;
const Section = ({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) => (
  <section className="space-y-3"><div><h2 className="text-base font-semibold text-zinc-100">{title}</h2>{sub && <p className="mt-0.5 max-w-3xl text-sm text-zinc-500">{sub}</p>}</div>{children}</section>
);

export default function CostsPage() {
  const token = useToken();
  const convex = useConvex();
  const startScan = useAction(api.ingest.startDriveScan);
  const [data, setData] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  // calculator
  const [leads, setLeads] = useState("10000");
  const [cost, setCost] = useState("");
  const [yld, setYld] = useState("");
  const [speed, setSpeed] = useState("800");
  const [savePct, setSavePct] = useState("40");
  const [chip, setChip] = useState<"A" | "B" | "C" | "">("A");
  const [allStates, setAllStates] = useState(false);

  // The page only reloads when you press Refresh. The last snapshot is kept in this browser so reopening the page shows it instantly.
  const refresh = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const r = (await convex.query(api.costs.report, { token })) as Report;
      setData(r);
      try { localStorage.setItem(CACHE, JSON.stringify(r)); } catch { /* storage unavailable */ }
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }, [convex, token]);

  useEffect(() => {
    let cached: Report | null = null;
    try { const raw = localStorage.getItem(CACHE); cached = raw ? (JSON.parse(raw) as Report) : null; } catch { /* ignore */ }
    if (cached) setData(cached); else void refresh();
  }, [refresh]);

  const m = useMemo(() => buildModel(data?.runs ?? []), [data]);
  const save = Math.min(95, Math.max(0, Number(savePct) || 0)) / 100;
  const A = m.scenA, B = m.scenB;
  const C = A ? { ...A, cost: A.cost * (1 - save) } : null;

  // Fill the calculator from the baseline once data arrives (until the user types their own numbers).
  useEffect(() => {
    if (A && cost === "" && yld === "") { setCost(A.cost.toFixed(4)); setYld((A.yld * 100).toFixed(1)); if (m.speed) setSpeed(String(m.speed)); }
  }, [A, cost, yld, m.speed]);

  const pick = (id: "A" | "B" | "C") => {
    const s = id === "A" ? A : id === "B" ? B : C;
    if (!s) return;
    setChip(id); setCost(s.cost.toFixed(4)); setYld((s.yld * 100).toFixed(1));
  };

  const n = Number(leads) || 0, c = Number(cost) || 0, y = (Number(yld) || 0) / 100, sp = Number(speed) || 1;
  const total = n * c, emails = n * y, hours = n / sp;
  const files = data?.scan?.files ?? [];
  const states = useMemo(() => [...files].sort((a, b) => b.fresh - a.fresh), [files]);
  const sum = (k: keyof ScanFile) => files.reduce((a, f) => a + (f[k] as number), 0);
  const allLeads = sum("fresh");

  async function scan() {
    setScanMsg("");
    try { await startScan({ token }); setScanMsg("Scan started. It takes a few minutes; press Refresh to see progress."); }
    catch (e) { setScanMsg(errMsg(e)); }
  }

  if (!data && busy) return <div className="p-10"><Spinner /></div>;

  const scan_ = data?.scan;
  return (
    <div className="space-y-8">
      <PageHeader title="Costs" sub={data ? `Snapshot from ${new Date(data.at).toLocaleString()} · ${int(data.runs.length)} runs. Numbers change only when you press Refresh.` : "No snapshot yet."}
        actions={<Button variant="primary" onClick={refresh} loading={busy}>Refresh</Button>} />
      <ErrorText>{err}</ErrorText>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Spent so far" value={money(m.spent)} hint={`${int(m.rows)} rows · ${int(m.leads)} leads researched`} tip="Every paid call the pipeline recorded: Exa, Gemini, TryKitt, Findymail, Bouncer and Instantly. Subscriptions and hosting are not included." />
            <Kpi label="Usable emails" value={int(m.usable)} hint={`${int(m.valid)} valid · ${int(m.catchAll)} catch-all`} tip="Valid = the mailbox was confirmed. Catch-all = the domain accepts any address, so it is likely but not certain. Risky emails are not counted." />
            <Kpi label="Cost per usable email" value={m.usable ? money(m.spent / m.usable) : "—"} hint={A && A.usable ? `${money(A.cost / A.yld)} in the biggest run` : undefined} tip="Total spend divided by usable emails. It includes the money spent on every lead that was rejected." />
            <Kpi label="Cost per lead" value={A ? money(A.cost) : "—"} hint={m.base ? `${m.base.name}, ${int(m.base.leads)} leads` : undefined} tip="Average spend for one lead that passed the free cleaning, taken from the biggest run. This is the number used to predict the full dataset." />
          </div>
          <Source>runs table: counters and provider costs the pipeline saves with every lead.</Source>

          <Section title="1. Where the money went" sub="Two views of the same total: by company paid, and by pipeline step.">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={<>By provider<Tip text="Exa and Gemini are real usage costs. Findymail, Bouncer and Instantly use prices typed into Settings, so treat those as estimates. TryKitt uses the credits it reports." /></>}>
                <div className="flex h-6 overflow-hidden rounded bg-zinc-800">
                  {m.providers.map((p) => <div key={p.key} title={`${p.label} ${money(p.v)}`} className={PROV_BG[p.key] ?? "bg-zinc-600"} style={{ width: `${(p.v / m.spent) * 100}%` }} />)}
                </div>
                <div className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {m.providers.map((p) => (
                    <div key={p.key} className="flex items-center gap-2 text-xs text-zinc-300"><span className={`h-2.5 w-2.5 rounded-sm ${PROV_BG[p.key] ?? "bg-zinc-600"}`} />{p.label}<span className="tabular ml-auto text-zinc-100">{money(p.v)} · {pct(p.v / m.spent)}</span></div>
                  ))}
                </div>
              </Card>
              <Card title={<>By pipeline step<Tip text="Research is the AI agent that decides if a company is a real property manager and finds the owner. It searches the web (Exa) and reasons about the results (Gemini), which is why it costs the most." /></>}>
                {m.hasStageCosts
                  ? <Bars items={m.stages.map((s) => ({ label: s.label, value: s.total, text: <>{money(s.total)} <span className="text-zinc-500">{pct(s.total / m.spent)}</span></>, tip: Object.entries(s.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${PROVIDER_LABEL[k] ?? k} ${money(v)}`).join(", ") }))} />
                  : <p className="text-sm text-zinc-500">Step costs are not recorded for these runs. Run <code>npx convex run costs:backfill</code> once.</p>}
              </Card>
            </div>
            <Source>runs.costs (provider) and the per-step counters (hover a step name for its provider split).</Source>
          </Section>

          {m.base && m.funnel.length > 0 && (
            <Section title={`2. What happens to ${int(m.base.leads)} leads`} sub={`The biggest run (${m.base.name}). Each bar is how many leads were still alive at that step; red lines say why the rest dropped out.`}>
              <Card>
                <div className="space-y-1">
                  {m.funnel.map((f, i) => (
                    <div key={f.label}>
                      {f.drop && <div className="ml-[calc(min(180px,30%)+0.75rem)] py-1 text-[11px] text-rose-300">−{int(f.drop.n)}{f.drop.text ? `: ${f.drop.text}` : ""}</div>}
                      <div className="grid grid-cols-[minmax(110px,180px)_1fr] items-center gap-3">
                        <div className="text-xs text-zinc-300">{f.label}<div className="text-[11px] text-zinc-500">{f.stageCost !== null ? `this step costs ${money(f.stageCost)}` : "end result"}</div></div>
                        <div className="flex items-center gap-2"><div className="h-5 rounded bg-emerald-500" style={{ width: `${Math.max((f.n / m.funnel[0].n) * 100, 1.2)}%`, opacity: 1 - i * 0.1 }} /><span className="tabular text-xs text-zinc-100">{int(f.n)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Source>{m.base.name}: counters in:&lt;step&gt;, rej:&lt;reason&gt; and the per-step costs. Spend of this run {money(m.base.spent)}, {int(m.base.usable)} usable emails.</Source>
            </Section>
          )}

          {m.outcomes.length > 0 && (
            <Section title="3. What the money bought" sub="The same total grouped by how each lead ended. Green bars are leads you can use.">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title={<>Spend by final outcome<Tip text="Each lead's total cost is added to the outcome it ended with. 'Not a target type' means the AI decided it is not a residential, HOA or commercial property manager." /></>}>
                  <Bars items={m.outcomes.slice(0, 10).map((o) => ({ label: o.label, value: o.cost, color: o.usable ? "bg-emerald-500" : o.key.startsWith("rej:not_icp") ? "bg-rose-500" : "bg-amber-500", text: <>{money(o.cost)} <span className="text-zinc-500">{pct(o.cost / m.spent)} · {int(o.n)}</span></> }))} />
                </Card>
                <Card title={<>Average cost of one lead, by outcome<Tip text="A lead that ends with a usable email has passed every step, so it is the most expensive. Leads rejected early (no website, wrong category) are almost free." /></>}>
                  <Table>
                    <thead><tr><Th>Outcome</Th><Th r>Leads</Th><Th r>Avg cost</Th></tr></thead>
                    <tbody>{[...m.outcomes].sort((a, b) => b.avg - a.avg).map((o) => <tr key={o.key}><Td>{o.label}</Td><Td r>{int(o.n)}</Td><Td r>{o.avg ? money(o.avg) : "$0"}</Td></tr>)}</tbody>
                  </Table>
                </Card>
              </div>
              {(() => {
                const bad = m.outcomes.find((o) => o.key === "rej:not_icp"), good = m.outcomes.filter((o) => o.usable).reduce((a, o) => a + o.cost, 0);
                return bad ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100"><b>{pct(bad.cost / m.spent)} of all spend</b> ({money(bad.cost)}) went to {int(bad.n)} leads that turned out not to be property managers we want. The leads that gave a usable email took {pct(good / m.spent)} ({money(good)}). This is the biggest place to save (section 7).</div> : null;
              })()}
              <Source>leads table (cost per lead, grouped by how it ended).</Source>
            </Section>
          )}

          {m.finders.length > 0 && (
            <Section title="4. Email finders compared" sub="Who found the usable emails, and what each finder cost.">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title={<>Usable emails by finder<Tip text="TryKitt is tried first. Findymail only runs when TryKitt finds nothing valid, so it gets the harder leads." /></>}>
                  <Bars items={m.finders.map((f) => ({ label: PROVIDER_LABEL[f.key] ?? f.key, value: f.n, color: PROV_BG[f.key], text: <>{int(f.n)} <span className="text-zinc-500">{pct(f.n / (m.usable || 1))}</span></> }))} />
                </Card>
                <Card title={<>Cost per usable email, by finder<Tip text="TryKitt side adds TryKitt, Bouncer and Instantly (the verifiers). Findymail side is its find price only, at the price in Settings. Findymail is far more expensive per email, but it adds the emails TryKitt could not find." /></>}>
                  {(() => {
                    const p = Object.fromEntries(m.providers.map((x) => [x.key, x.v]));
                    const rows = m.finders.map((f) => {
                      const spendK = f.key === "trykitt" ? (p.trykitt ?? 0) + (p.bouncer ?? 0) + (p.instantly ?? 0) : p[f.key] ?? 0;
                      return { label: PROVIDER_LABEL[f.key] ?? f.key, value: f.n ? spendK / f.n : 0, color: PROV_BG[f.key], text: money(f.n ? spendK / f.n : 0) };
                    });
                    return <Bars items={rows} />;
                  })()}
                </Card>
              </div>
              <Source>leads.emailSource for finished leads with valid / catch-all email; provider totals from runs.costs.</Source>
            </Section>
          )}

          <Section title="5. Predict the future cost" sub="Two numbers drive everything: what one lead costs, and how many leads end with a usable email.">
            <div className="overflow-x-auto rounded-lg bg-zinc-900 px-4 py-2.5 font-mono text-xs text-zinc-300">total cost = leads × cost per lead &nbsp;·&nbsp; usable emails = leads × yield &nbsp;·&nbsp; cost per email = cost per lead ÷ yield</div>
            {A ? (
              <>
                <Card title={<>Three scenarios<Tip text="A is measured on the biggest run. B is every other run combined (small samples, less reliable). C is A with the saving you set below; that saving is an assumption until the cost cuts in section 7 are switched on." /></>}
                  actions={<label className="flex items-center gap-1.5 text-xs text-zinc-400">C saves<Input className="w-16" type="number" min={0} max={95} value={savePct} onChange={(e) => setSavePct(e.target.value)} />%</label>}>
                  <Table>
                    <thead><tr><Th>Scenario</Th><Th r>Cost / lead</Th><Th r>Usable / 100</Th><Th r>Cost / email</Th>{[1000, 5000, 10000].map((k) => <Th key={k} r>{int(k)} leads</Th>)}{allLeads > 0 && <Th r>All data ({int(allLeads)})</Th>}</tr></thead>
                    <tbody>
                      {([["A · Biggest run", A, "text-emerald-300"], ["B · Other runs combined", B, "text-amber-300"], ["C · A with savings", C, "text-sky-300"]] as const).map(([name, s, col]) => s && (
                        <tr key={name}><Td><span className={col}>●</span> {name}{name.startsWith("B") && <span className="text-zinc-500"> ({int(s.leads)} leads)</span>}</Td><Td r>{money(s.cost)}</Td><Td r>{(s.yld * 100).toFixed(1)}</Td><Td r>{money(s.cost / s.yld)}</Td>
                          {[1000, 5000, 10000].map((k) => <Td key={k} r>{money(k * s.cost)}<div className="text-zinc-500">{int(k * s.yld)} emails</div></Td>)}
                          {allLeads > 0 && <Td r>{money(allLeads * s.cost)}<div className="text-zinc-500">{int(allLeads * s.yld)} emails</div></Td>}</tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>

                <Card title={<>Total cost as the data grows<Tip text="The shaded band is the range between the cheapest and the most expensive scenario. The dashed line marks the whole dataset once you have scanned the Drive files (section 6)." /></>}>
                  {(() => {
                    const lines = ([[A, "stroke-emerald-400 fill-emerald-400"], [B, "stroke-amber-400 fill-amber-400"], [C, "stroke-sky-400 fill-sky-400"]] as const).filter((l) => l[0]) as unknown as [{ cost: number }, string][];
                    const xe = allLeads || 100000, XM = niceCeil(xe), YM = niceCeil(Math.max(...lines.map(([s]) => s.cost)) * xe);
                    const W = 680, H = 290, L = 64, R = 92, T = 14, Bt = 38;
                    const sx = (x: number) => L + (x / XM) * (W - L - R), sy = (v: number) => H - Bt - (v / YM) * (H - T - Bt);
                    const lo = Math.min(...lines.map(([s]) => s.cost)), hi = Math.max(...lines.map(([s]) => s.cost));
                    return (
                      <div className="overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px]" role="img" aria-label="Projected total cost against number of leads">
                        {[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1={L} x2={W - R} y1={sy((YM / 4) * i)} y2={sy((YM / 4) * i)} className="stroke-zinc-800" /><text x={L - 8} y={sy((YM / 4) * i) + 4} textAnchor="end" className="fill-zinc-500 text-[11px]">{money((YM / 4) * i)}</text></g>)}
                        {[0, 1, 2, 3, 4].map((i) => <text key={i} x={sx((XM / 4) * i)} y={H - 18} textAnchor="middle" className="fill-zinc-500 text-[11px]">{int((XM / 4) * i)}</text>)}
                        <text x={(L + W - R) / 2} y={H - 3} textAnchor="middle" className="fill-zinc-500 text-[11px]">leads processed</text>
                        <path d={`M${sx(0)},${sy(0)} L${sx(xe)},${sy(xe * lo)} L${sx(xe)},${sy(xe * hi)} Z`} className="fill-emerald-400/10" />
                        {allLeads > 0 && <><line x1={sx(xe)} x2={sx(xe)} y1={T} y2={H - Bt} className="stroke-zinc-500" strokeDasharray="4 4" /><text x={sx(xe) - 4} y={T + 10} textAnchor="end" className="fill-zinc-500 text-[11px]">all data {int(xe)}</text></>}
                        {lines.map(([s, cls], i) => <g key={i}><line x1={sx(0)} y1={sy(0)} x2={sx(xe)} y2={sy(xe * s.cost)} strokeWidth={2.5} strokeLinecap="round" className={cls.split(" ")[0]} /><circle cx={sx(xe)} cy={sy(xe * s.cost)} r={4} className={cls.split(" ")[1]} /><text x={sx(xe) + 8} y={sy(xe * s.cost) + 4} className="fill-zinc-200 text-[11px]">{money(xe * s.cost)}</text></g>)}
                      </svg></div>
                    );
                  })()}
                </Card>

                <Card title={<>Calculator<Tip text="Pick a scenario or type your own numbers. The state table below uses the same cost and yield, so you can see what each state would cost." /></>}>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {(["A", "B", "C"] as const).map((id) => (id === "B" && !B) ? null : <button key={id} type="button" onClick={() => pick(id)} aria-pressed={chip === id} className={`rounded-full border px-3 py-1 text-xs ${chip === id ? "border-emerald-500 bg-emerald-500 text-zinc-950" : "border-zinc-700 bg-zinc-800 text-zinc-200"}`}>{id === "A" ? "A · Biggest run" : id === "B" ? "B · Other runs" : "C · With savings"}</button>)}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div><Label>Leads to process</Label><Input type="number" min={0} step={100} value={leads} onChange={(e) => setLeads(e.target.value)} /></div>
                    <div><Label>Cost per lead (USD)</Label><Input type="number" min={0} step="0.001" value={cost} onChange={(e) => { setCost(e.target.value); setChip(""); }} /></div>
                    <div><Label>Usable emails per 100 leads</Label><Input type="number" min={0} step="0.1" value={yld} onChange={(e) => { setYld(e.target.value); setChip(""); }} /></div>
                    <div><Label>Speed (leads per hour)</Label><Input type="number" min={1} step={50} value={speed} onChange={(e) => setSpeed(e.target.value)} /></div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[["total cost", money(total)], ["usable emails", int(emails)], ["cost per usable email", emails > 0 ? money(total / emails) : "—"], ["run time", hours >= 48 ? `${(hours / 24).toFixed(1)} days` : hours >= 1 ? `${hours.toFixed(1)} hours` : `${Math.round(hours * 60)} min`]].map(([l, v]) => (
                      <div key={l} className="rounded-lg bg-zinc-800/60 p-3"><div className="tabular text-xl text-zinc-50">{v}</div><div className="text-xs text-zinc-500">{l}</div></div>
                    ))}
                  </div>
                </Card>
                <Source>A: {m.base?.name} ({int(A.leads)} leads, {money(A.cost * A.leads)}, {int(A.usable)} usable). Speed: {m.speed ? `${int(m.speed)} leads/hour measured on that run` : "default guess (no finished baseline run)"}.</Source>
              </>
            ) : <p className="text-sm text-zinc-500">Run at least one file to get a baseline.</p>}
          </Section>

          <Section title="6. Every state, projected" sub="Rows come from the CSV files on Drive. New leads = rows that pass the free cleaning and were never processed. Cost and emails use the calculator numbers above.">
            <Card title={<>Drive files<Tip text="Reading all 52 files takes a few minutes, so it is a separate button. The result is saved; press Refresh afterwards to see it here." /></>}
              actions={<Button size="sm" onClick={scan} disabled={scan_?.status === "running"}>{scan_ ? "Scan again" : "Scan Drive files"}</Button>}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                {scan_ ? <>
                  <Badge tone={scan_.status === "done" ? "green" : scan_.status === "error" ? "red" : "amber"}>{scan_.status}</Badge>
                  {scan_.status === "running" && <span>{scan_.done}/{scan_.total || "…"} files. Press Refresh to update.</span>}
                  {scan_.status === "done" && <span>Scanned {new Date(scan_.finishedAt ?? scan_.startedAt).toLocaleString()}</span>}
                  {scan_.status === "error" && <span className="text-rose-300">{scan_.error}</span>}
                </> : <span>Not scanned yet. Press “Scan Drive files”.</span>}
                {scanMsg && <span className="text-zinc-300">{scanMsg}</span>}
              </div>
            </Card>
            {files.length > 0 && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title={<>Ten biggest states, projected cost<Tip text="Texas is about a third of all new leads on its own." /></>}>
                    <Bars items={states.slice(0, 10).map((s) => ({ label: s.name, value: s.fresh * c, text: money(s.fresh * c) }))} />
                  </Card>
                  <Card title="All files together">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {[["raw rows", int(sum("rows"))], ["pass free cleaning", int(sum("passing"))], ["done before", int(sum("seen"))], ["new leads", int(allLeads)], ["projected cost", money(allLeads * c)], ["projected usable emails", int(allLeads * y)]].map(([l, v]) => (
                        <div key={l} className="rounded-lg bg-zinc-800/60 p-3"><div className="tabular text-lg text-zinc-50">{v}</div><div className="text-xs text-zinc-500">{l}</div></div>
                      ))}
                    </div>
                  </Card>
                </div>
                <Card>
                  <Table>
                    <thead><tr><Th>State</Th><Th r>Rows</Th><Th r>Pass cleaning</Th><Th r>Done before</Th><Th r>New leads</Th><Th r>Projected cost</Th><Th r>Usable emails</Th></tr></thead>
                    <tbody>{(allStates ? states : states.slice(0, 15)).map((s) => <tr key={s.name} className={s.seen ? "bg-emerald-500/5" : ""}><Td>{s.name}</Td><Td r>{int(s.rows)}</Td><Td r>{int(s.passing)}</Td><Td r>{int(s.seen)}</Td><Td r>{int(s.fresh)}</Td><Td r>{money(s.fresh * c)}</Td><Td r>{int(s.fresh * y)}</Td></tr>)}</tbody>
                  </Table>
                  {states.length > 15 && <div className="mt-3"><Button size="sm" onClick={() => setAllStates(!allStates)}>{allStates ? "Show the 15 biggest" : `Show all ${states.length} files`}</Button></div>}
                </Card>
              </>
            )}
            <Source>Drive folder (free preview of every CSV). Rows marked green were partly processed before.</Source>
          </Section>

          {m.levers.length > 0 && (
            <Section title="7. Ways to cut the cost" sub={`Estimated savings per 1,000 leads, worked out from ${m.base?.name}. These are estimates; none is switched on yet.`}>
              <Card>
                <Table>
                  <thead><tr><Th>Change</Th><Th>How it works</Th><Th r>Saves per 1,000 leads</Th><Th>Risk</Th></tr></thead>
                  <tbody>{m.levers.map((l) => <tr key={l.name}><Td wrap><b className="text-zinc-100">{l.name}</b></Td><Td wrap>{l.how}</Td><Td r>{money(l.per1000)}<div className="text-zinc-500">{pct(l.per1000 / (m.base ? (m.base.spent / m.base.leads) * 1000 : 1))}</div></Td><Td wrap>{l.risk}</Td></tr>)}</tbody>
                </Table>
              </Card>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-100">The changes overlap (cutting searches also shrinks what the pre-check saves), so the savings do not add up fully. Scenario C uses the percentage you set in section 5.</div>
            </Section>
          )}

          <Section title="8. How much to trust these numbers">
            <Card>
              <Table>
                <thead><tr><Th>Number</Th><Th>Status</Th><Th>Why</Th></tr></thead>
                <tbody>
                  {([
                    ["Exa cost", "green", "Measured", "Exa returns the real cost of every call."],
                    ["Gemini cost", "green", "Computed", "Tokens used × the per-token prices in Settings. Accurate while those prices are current."],
                    ["TryKitt cost", "green", "Measured", "TryKitt reports credits used per call; one credit is counted as one dollar."],
                    ["Findymail cost", "amber", "Assumed", `${money(data.prices.findymailFound ?? 0)} per email found is a Settings value, not your real plan price. Check your invoice.`],
                    ["Bouncer cost", "amber", "Assumed", `${money(data.prices.bouncerVerify ?? 0)} per check is a Settings value. The first real charge will show the true price.`],
                    ["Instantly verify cost", "amber", "Assumed", `Counted at ${money(data.prices.instantlyVerify ?? 0)}. It is no longer used for verifying, so only old runs show it.`],
                    ["Yield (usable per 100 leads)", "amber", "Uncertain", "Small runs vary a lot, so rely on the biggest run (scenario A) and re-check after each large run."],
                    ["Full-dataset projection", "amber", "Projection", "Assumes later states behave like the baseline. Run another large state before committing the budget."],
                    ["Not included", "red", "Missing", "Convex and Vercel hosting, and subscription fees for Findymail, TryKitt, Bouncer and Instantly."],
                  ] as const).map(([k, tone, tag, why]) => <tr key={k}><Td>{k}</Td><Td><Badge tone={tone}>{tag}</Badge></Td><Td wrap>{why}</Td></tr>)}
                </tbody>
              </Table>
            </Card>
          </Section>
        </>
      )}
    </div>
  );
}
