"use client";
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToken } from "@/lib/session";
import { Badge, Button, Card, ErrorText, Input, Label, PageHeader, Spinner, Textarea, cx, errMsg } from "@/components/ui";

const NAMES: Record<string, string> = {
  domain: "Pick official website", building_check: "Apartment / building check", research: "Research agent (ICP + owner + go/no-go)",
  review_line: "Review-based first line", description: "Website description", service_label: "Primary service label",
  campaign_vars: "Campaign variables", site_read: "Website reader (fallback)",
};
const PLACEHOLDERS = ["name", "company", "building_note", "max_tools", "category", "city", "state", "phone", "domain", "site", "reviews", "evidence", "results", "summary", "variables", "url"];

export default function PromptsPage() {
  const token = useToken();
  const prompts = useQuery(api.settings.prompts, { token });
  const save = useMutation(api.settings.savePrompt);
  const activate = useMutation(api.settings.activatePrompt);
  const test = useAction(api.leads.testPrompt);
  const [sel, setSel] = useState("domain");
  const [text, setText] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [out, setOut] = useState("");
  const [testing, setTesting] = useState(false);

  const cur = prompts?.find((p) => p.key === sel);
  // Load the active text when the selection (or its active version) changes.
  const sig = cur ? `${cur.key}:${cur.activeVersion}` : "";
  useEffect(() => {
    if (cur && sig !== loadedFor) { setText(cur.text); setLoadedFor(sig); setErr(""); setOut(""); }
  }, [cur, sig, loadedFor]);

  async function run(fn: () => Promise<unknown>) {
    setErr(""); setBusy(true);
    try { await fn(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  async function runTest() {
    setErr(""); setOut(""); setTesting(true);
    try { setOut(await test({ token, key: sel, text, leadId: leadId.trim() as Id<"leads"> })); }
    catch (e) { setErr(errMsg(e)); } finally { setTesting(false); }
  }

  if (!prompts) return <Spinner />;
  return (
    <div>
      <PageHeader title="Prompts" sub="Edit the instructions Gemini gets at each stage. Saving creates a new active version; older versions stay available." />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <nav className="flex flex-col gap-1">
          {prompts.map((p) => (
            <button key={p.key} onClick={() => setSel(p.key)}
              className={cx("rounded-lg px-3 py-2 text-left text-sm", sel === p.key ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900")}>
              <div>{NAMES[p.key] ?? p.key}</div>
              <div className="text-[11px] text-zinc-600">{p.key} · {p.activeVersion ? `v${p.activeVersion}` : "default"}</div>
            </button>
          ))}
        </nav>

        {cur && (
          <div className="space-y-4">
            <Card title={<span className="flex items-center gap-2">{NAMES[cur.key] ?? cur.key} <Badge tone="green">{cur.activeVersion ? `v${cur.activeVersion} active` : "default active"}</Badge></span>}
              actions={<>
                <Button size="sm" disabled={busy} onClick={() => run(() => activate({ token, key: cur.key, version: 0 }))}>Reset to default</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={text === cur.text || !text.trim()} onClick={() => run(() => save({ token, key: cur.key, text }))}>Save as new version</Button>
              </>}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-96" spellCheck={false} />
              <p className="mt-2 text-xs text-zinc-500">
                Placeholders: {PLACEHOLDERS.map((p) => <code key={p} className="mr-1 text-zinc-300">{`{{${p}}}`}</code>)}
                Text inside <code className="text-zinc-300">&lt;data&gt;</code> blocks is treated as untrusted (scraped websites and reviews); keep untrusted placeholders inside them.
              </p>
              <div className="mt-2"><ErrorText>{err}</ErrorText></div>
            </Card>

            <Card title="Test on a lead">
              <Label hint="(copy a lead id from the lead drawer header; runs one Gemini call with the current editor text, unsaved)">Lead id</Label>
              <div className="flex gap-2">
                <Input value={leadId} onChange={(e) => setLeadId(e.target.value)} placeholder="Lead id" className="font-mono" />
                <Button loading={testing} disabled={!leadId.trim()} onClick={runTest}>Run test</Button>
              </div>
              {out && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{out}</pre>}
            </Card>

            <Card title="Version history">
              {cur.versions.length === 0 && <p className="text-sm text-zinc-500">No saved versions. The built-in default is in use.</p>}
              <ul className="divide-y divide-zinc-800">
                {cur.versions.map((v) => (
                  <li key={v.version} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-10 text-zinc-300">v{v.version}</span>
                    <span className="flex-1 truncate text-xs text-zinc-500">{new Date(v.createdAt).toLocaleString()} · {v.text.slice(0, 80)}</span>
                    <Button size="sm" variant="ghost" onClick={() => setText(v.text)}>Load</Button>
                    {v.active ? <Badge tone="green">active</Badge> : <Button size="sm" disabled={busy} onClick={() => run(() => activate({ token, key: cur.key, version: v.version }))}>Activate</Button>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
