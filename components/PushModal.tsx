"use client";
import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToken } from "@/lib/session";
import { Button, ErrorText, Label, Select, Spinner, errMsg } from "@/components/ui";

export function PushModal({ runId, onClose }: { runId?: Id<"runs">; onClose: () => void }) {
  const token = useToken();
  const loadCampaigns = useAction(api.leads.campaigns);
  const push = useAction(api.leads.push);
  const [camps, setCamps] = useState<{ id: string; name: string }[] | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [catchAll, setCatchAll] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ uploaded: number; skipped: number; considered: number } | null>(null);

  useEffect(() => {
    let live = true;
    loadCampaigns({ token }).then((c) => { if (live) { setCamps(c); if (c[0]) setCampaignId(c[0].id); } })
      .catch((e) => { if (live) { setErr(errMsg(e)); setCamps([]); } });
    return () => { live = false; };
  }, [loadCampaigns, token]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function go() {
    if (!runId) return;
    setErr(""); setBusy(true);
    try { setResult(await push({ token, campaignId, includeCatchAll: catchAll, runId })); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-zinc-50">Push to Instantly</h2>
        {result ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-emerald-300">Done. Uploaded {result.uploaded}, skipped {result.skipped} (of {result.considered} eligible).</p>
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {!runId && <p className="text-sm text-amber-200">Filter the grid by a run first. Pushing is scoped to one run's ready leads.</p>}
            {camps === null ? <Spinner /> : (
              <div>
                <Label>Campaign</Label>
                <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!camps.length}>
                  {camps.length === 0 && <option value="">No campaigns available</option>}
                  {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={catchAll} onChange={(e) => setCatchAll(e.target.checked)} className="accent-emerald-500" />
              Include catch-all emails
            </label>
            <div className="text-sm text-zinc-400">
              Scope: {runId ? "All ready leads in this run (not yet pushed)" : "none selected"}
            </div>
            <ErrorText>{err}</ErrorText>
            <p className="text-xs text-zinc-500">Missing campaigns usually means INSTANTLY_API_KEY is not set in Convex.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!runId || !campaignId} onClick={go}>Push</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
