"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToken } from "@/lib/session";
import { Badge, Button, Card, Empty, ErrorText, Input, Label, PageHeader, Spinner, Stat, ago, cx, errMsg, int } from "@/components/ui";

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; size?: string | number };
const SHEET = "application/vnd.google-apps.spreadsheet";
const MAX = 200 * 1024 * 1024;
const kb = (s?: string | number) => (s === undefined ? "—" : Number(s) > 1e6 ? `${(Number(s) / 1e6).toFixed(1)} MB` : `${Math.round(Number(s) / 1e3)} KB`);

export default function NewRun() {
  const token = useToken();
  const router = useRouter();
  const listFiles = useAction(api.ingest.driveFiles);
  const startRun = useAction(api.ingest.startRun);
  const fileStats = useAction(api.ingest.fileStats);
  type Stats = { rows: number; passing: number; buildings: number; alreadySeen: number; newLeads: number; dropped: Record<string, number> };
  const [stats, setStats] = useState<Record<string, Stats | "loading" | string>>({});
  const loadStats = useCallback(async (id: string) => {
    setStats((m) => ({ ...m, [id]: "loading" }));
    try { const s = await fileStats({ token, driveFileId: id }); setStats((m) => ({ ...m, [id]: s })); }
    catch (e) { setStats((m) => ({ ...m, [id]: errMsg(e) })); }
  }, [fileStats, token]);
  const genUrl = useMutation(api.runs.generateUploadUrl);
  const s = useQuery(api.settings.get, { token });
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [driveErr, setDriveErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [budget, setBudget] = useState("");
  const [maxNew, setMaxNew] = useState("5000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try { const r = await listFiles({ token }); setFiles(r.files as DriveFile[]); setDriveErr(r.error); }
    catch (e) { setDriveErr(errMsg(e)); setFiles([]); }
    setLoading(false);
  }, [listFiles, token]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (s && budget === "") setBudget(String(s.settings.defaultBudgetUsd)); }, [s, budget]);

  const b = Number(budget);
  const m = maxNew.trim() ? Number(maxNew) : undefined;
  const ok = b > 0 && (!!sel || !!file) && (m === undefined || (Number.isInteger(m) && m > 0));
  const pick = (f: File | null) => {
    setErr("");
    if (f && f.size > MAX) { setErr("File is over 200 MB — put it in the Drive folder instead."); return; }
    if (f && !f.name.toLowerCase().endsWith(".csv")) { setErr("Only .csv files."); return; }
    setFile(f); if (f) setSel(null);
  };
  const start = async () => {
    setBusy(true); setErr("");
    try {
      let id: Id<"runs">;
      if (file) {
        const url = await genUrl({ token });
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "text/csv" }, body: file });
        if (!res.ok) throw new Error("Upload failed");
        const { storageId } = await res.json();
        id = await startRun({ token, budgetUsd: b, maxNew: m, storageId, fileName: file.name });
      } else {
        const f = files?.find((x) => x.id === sel);
        id = await startRun({ token, budgetUsd: b, maxNew: m, driveFileId: sel!, fileName: f?.name });
      }
      router.push(`/runs/${id}`);
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="New run" sub="Pick a Google Maps CSV, set a budget, and start." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Google Drive" actions={<Button size="sm" onClick={refresh} loading={loading}>Refresh</Button>}>
          {driveErr && (
            <div className="mb-3 space-y-1">
              <ErrorText>{driveErr}</ErrorText>
              <p className="text-xs text-zinc-500">Set GOOGLE_SERVICE_ACCOUNT_JSON and DRIVE_FOLDER_ID in Convex → Settings → Environment Variables, and share the Drive folder with the service-account email as Viewer.</p>
            </div>
          )}
          {!files ? <Spinner /> : files.length === 0 ? <Empty>No CSV files found.</Empty> : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {files.map((f) => (
                <li key={f.id}>
                  <label className={cx("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", sel === f.id ? "border-emerald-500/50 bg-emerald-500/5" : "border-transparent hover:bg-zinc-800/50")}>
                    <input type="radio" name="drive" checked={sel === f.id} onChange={() => { setSel(f.id); setFile(null); if (!stats[f.id]) void loadStats(f.id); }} className="accent-emerald-500" />
                    <span className="min-w-0 flex-1 truncate text-zinc-100">{f.name}</span>
                    {f.mimeType === SHEET && <Badge tone="green">Sheet</Badge>}
                    <span className="whitespace-nowrap text-xs text-zinc-500">{ago(new Date(f.modifiedTime).getTime())} · {kb(f.size)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Upload a CSV">
          <Input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="h-auto py-1.5" />
          <p className="mt-2 text-xs text-zinc-500">.csv only, max 200 MB (bigger files: use the Drive folder).{file && <> Selected: <span className="text-zinc-300">{file.name}</span></>}</p>
          <p className="mt-4 text-xs text-zinc-500">Expected columns (Google Maps export): place_id, name, category, website, phone, state, county_name, allReviews, and so on. Rows without a name are rejected; duplicates are skipped.</p>
        </Card>
      </div>
      {sel && <div className="mt-4"><FileStatsCard name={files?.find((x) => x.id === sel)?.name ?? ""} s={stats[sel]} onWhole={() => setMaxNew("")} onRetry={() => loadStats(sel)} /></div>}
      <Card className="mt-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-40"><Label>Budget (USD)</Label><Input type="number" min="0" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <div className="w-44"><Label hint="blank = all">Max new leads</Label><Input type="number" min="1" step="500" value={maxNew} onChange={(e) => setMaxNew(e.target.value)} /></div>
          <p className="flex-1 pb-2 text-xs text-zinc-500">The run auto-pauses when spend reaches the budget. Max new leads counts only leads that pass the free cleaning; companies done in earlier runs are skipped for free, so run a big state (TX) again to get the next batch.</p>
          <Button variant="primary" disabled={!ok} loading={busy} onClick={start}>{busy ? "Importing…" : "Start run"}</Button>
        </div>
        <div className="mt-2"><ErrorText>{err}</ErrorText></div>
      </Card>
    </div>
  );
}

const DROP_LABELS: Record<string, string> = {
  category: "wrong category (trades, stores…)", chain: "national chain", closed: "closed", no_name: "no name",
};

function FileStatsCard({ name, s, onWhole, onRetry }: {
  name: string;
  s: { rows: number; passing: number; buildings: number; alreadySeen: number; newLeads: number; dropped: Record<string, number> } | "loading" | string | undefined;
  onWhole: () => void; onRetry: () => void;
}) {
  if (!s) return null;
  if (s === "loading") return <Card title={`File preview · ${name}`}><div className="flex items-center gap-2 text-sm text-zinc-400"><Spinner /> Counting rows and checking which companies were already processed (free — big files like TX take ~20–30 s)…</div></Card>;
  if (typeof s === "string") return <Card title={`File preview · ${name}`}><ErrorText>{s}</ErrorText><Button size="sm" className="mt-2" onClick={onRetry}>Retry</Button></Card>;
  const lo = s.newLeads * 0.008, hi = s.newLeads * 0.03;
  return (
    <Card title={`File preview · ${name}`} actions={s.newLeads > 0 ? <Button size="sm" variant="primary" onClick={onWhole}>Run whole file ({int(s.newLeads)} leads)</Button> : null}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Rows in file" value={int(s.rows)} />
        <Stat label="Pass free cleaning" value={int(s.passing)} hint={s.buildings ? `${int(s.buildings)} are apartment/condo buildings` : undefined} />
        <Stat label="Already processed" value={int(s.alreadySeen)} hint="done in earlier runs — never processed again" />
        <Stat label="New leads to research" value={int(s.newLeads)} tone="good" />
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Removed for free: {Object.entries(s.dropped).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${int(n)} ${DROP_LABELS[k] ?? k}`).join(" · ") || "none"}.
        {" "}{s.newLeads === 0
          ? "Nothing new — every company in this file was already processed, so a run would cost $0."
          : <>Research cost for the {int(s.newLeads)} new leads ≈ ${lo < 1 ? lo.toFixed(2) : lo.toFixed(0)}–${hi < 1 ? hi.toFixed(2) : hi.toFixed(0)} (about $0.008–0.03 each), plus email finding for the ones that pass. The budget still caps the run.</>}
      </p>
    </Card>
  );
}
