"use client";
import { useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/session";
import { Badge, Button, Card, ErrorText, Input, Label, PageHeader, Spinner, Textarea, errMsg, Select, ago, int } from "@/components/ui";

type CV = { key: string; sentence: string; instructions: string; fallback: string };
type S = {
  allowCategories: string[]; denyCategories: string[]; chains: string[]; buildingCategories: string[]; agentMaxTools: number; icpSegments: string[]; allowedTitles: string[];
  minOwnerConfidence: number; maxCompanySize: string; batchSize: number; defaultBudgetUsd: number; countCatchAllAsUsable: boolean;
  models: Record<string, string>; prices: Record<string, number>; campaignVariables: CV[];
};

const KEYS: [string, string][] = [
  ["gemini", "GEMINI_API_KEY"], ["exa", "EXA_API_KEY"], ["findymail", "FINDYMAIL_API_KEY"], ["trykitt", "TRYKITT_API_KEY"],
  ["instantly", "INSTANTLY_API_KEY"], ["googleServiceAccount", "GOOGLE_SERVICE_ACCOUNT_JSON"], ["driveFolder", "DRIVE_FOLDER_ID"],
];
const SEGS = ["residential", "hoa", "commercial", "vacation"];
const lines = (a: string[]) => a.join("\n");
const unlines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function Section({ title, children, build, token }: { title: string; children: ReactNode; build: () => Record<string, unknown> | string; token: string }) {
  const save = useMutation(api.settings.save);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setErr(""); setOk(false);
    const data = build();
    if (typeof data === "string") { setErr(data); return; }
    setBusy(true);
    try { await save({ token, data }); setOk(true); setTimeout(() => setOk(false), 2500); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Card title={title} actions={<>{ok && <span className="text-xs text-emerald-400">Saved</span>}<Button size="sm" variant="primary" loading={busy} onClick={go}>Save</Button></>}>
      <div className="space-y-4">{children}<ErrorText>{err}</ErrorText></div>
    </Card>
  );
}

function Form({ init, keyStatus, mock, token }: { init: S; keyStatus: Record<string, boolean>; mock: boolean; token: string }) {
  const [allow, setAllow] = useState(lines(init.allowCategories));
  const [deny, setDeny] = useState(lines(init.denyCategories));
  const [chains, setChains] = useState(lines(init.chains));
  const [buildings, setBuildings] = useState(lines(init.buildingCategories));
  const [maxTools, setMaxTools] = useState(String(init.agentMaxTools));
  const [segs, setSegs] = useState<string[]>(init.icpSegments);
  const [titles, setTitles] = useState(lines(init.allowedTitles));
  const [minConf, setMinConf] = useState(String(init.minOwnerConfidence));
  const [maxSize, setMaxSize] = useState(init.maxCompanySize);
  const [batch, setBatch] = useState(String(init.batchSize));
  const [budget, setBudget] = useState(String(init.defaultBudgetUsd));
  const [catchAll, setCatchAll] = useState(init.countCatchAllAsUsable);
  const [models, setModels] = useState(init.models);
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(Object.entries(init.prices).map(([k, v]) => [k, String(v)])));
  const [vars, setVars] = useState<CV[]>(init.campaignVariables);

  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const setVar = (i: number, p: Partial<CV>) => setVars(vars.map((v, j) => (j === i ? { ...v, ...p } : v)));

  return (
    <div className="space-y-4">
      <ReviewsImport token={token} />

      <Card title="API keys">
        <div className="flex flex-wrap gap-2">
          {KEYS.map(([k, env]) => <Badge key={k} tone={keyStatus[k] ? "green" : "red"}>{env}: {keyStatus[k] ? "set" : "missing"}</Badge>)}
          {mock && <Badge tone="amber">PIPELINE_MOCK=1 (fake data)</Badge>}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Keys are never shown here. Add them in the Convex dashboard under Settings, then Environment Variables. Names: GEMINI_API_KEY, EXA_API_KEY,
          FINDYMAIL_API_KEY, TRYKITT_API_KEY, INSTANTLY_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_FOLDER_ID, APP_PASSWORD, and PIPELINE_MOCK=1 for fake data.
        </p>
      </Card>

      <Section token={token} title="Cleaning rules" build={() => ({ allowCategories: unlines(allow), denyCategories: unlines(deny), chains: unlines(chains), buildingCategories: unlines(buildings) })}>
        <p className="text-xs text-zinc-500">One item per line, matched as lowercase substrings of the Google category (chains: of the business name).</p>
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label>Allow categories</Label><Textarea rows={10} value={allow} onChange={(e) => setAllow(e.target.value)} /></div>
          <div><Label>Deny categories</Label><Textarea rows={10} value={deny} onChange={(e) => setDeny(e.target.value)} /></div>
          <div><Label>Chains to exclude</Label><Textarea rows={10} value={chains} onChange={(e) => setChains(e.target.value)} /></div>
        </div>
        <div><Label hint="(single properties — kept, then resolved to the management company behind them)">Building categories</Label><Textarea rows={4} value={buildings} onChange={(e) => setBuildings(e.target.value)} /></div>
      </Section>

      <Section token={token} title="Go / No-go gates" build={() => {
        const c = num(minConf);
        if (!(c >= 0 && c <= 1)) return "Min owner confidence must be between 0 and 1";
        return { icpSegments: segs, allowedTitles: unlines(titles), minOwnerConfidence: c, maxCompanySize: maxSize };
      }}>
        <div>
          <Label>ICP segments that may proceed</Label>
          <div className="flex flex-wrap gap-4">
            {SEGS.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" className="accent-emerald-500" checked={segs.includes(s)} onChange={(e) => setSegs(e.target.checked ? [...segs, s] : segs.filter((x) => x !== s))} />{s}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label hint="(one per line, substring match)">Allowed owner titles</Label><Textarea rows={5} value={titles} onChange={(e) => setTitles(e.target.value)} /></div>
          <div className="space-y-3">
            <div><Label hint="(0-1)">Min owner confidence</Label><Input type="number" step="0.05" min={0} max={1} value={minConf} onChange={(e) => setMinConf(e.target.value)} /></div>
            <div><Label hint="(employees, as estimated by the agent; unknown passes)">Max company size</Label>
              <Select value={maxSize} onChange={(e) => setMaxSize(e.target.value)}>
                {["1-10", "11-50", "51-200", "200+"].map((s) => <option key={s} value={s}>{s === "200+" ? "No limit" : `Up to ${s.split("-")[1]}`}</option>)}
              </Select>
            </div>
          </div>
        </div>
      </Section>

      <Section token={token} title="Run settings" build={() => {
        const b = num(batch), d = num(budget), t = num(maxTools);
        if (!(b >= 1 && b <= 50)) return "Batch size must be 1-50";
        if (!(t >= 0 && t <= 10)) return "Agent tool calls must be 0-10";
        if (!(d >= 0)) return "Budget must be 0 or more";
        return { batchSize: Math.round(b), defaultBudgetUsd: d, countCatchAllAsUsable: catchAll, agentMaxTools: Math.round(t) };
      }}>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label hint="(1-50 leads per tick)">Batch size</Label><Input type="number" min={1} max={50} value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
          <div><Label hint="(USD)">Default budget per run</Label><Input type="number" min={0} step="1" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <div><Label hint="(searches / page reads per lead, 0-10)">Research agent max tool calls</Label><Input type="number" min={0} max={10} value={maxTools} onChange={(e) => setMaxTools(e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" className="accent-emerald-500" checked={catchAll} onChange={(e) => setCatchAll(e.target.checked)} />Count catch-all emails as usable
        </label>
      </Section>

      <Section token={token} title="Models and prices" build={() => {
        const p: Record<string, number> = {};
        for (const [k, v] of Object.entries(prices)) { const n = num(v); if (!(n >= 0)) return `Price ${k} must be a number >= 0`; p[k] = n; }
        if (!models.fast.trim() || !models.smart.trim()) return "Model names are required";
        return { models: { fast: models.fast.trim(), smart: models.smart.trim() }, prices: p };
      }}>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Fast model</Label><Input value={models.fast} onChange={(e) => setModels({ ...models, fast: e.target.value })} /></div>
          <div><Label>Smart model</Label><Input value={models.smart} onChange={(e) => setModels({ ...models, smart: e.target.value })} /></div>
        </div>
        <p className="text-xs text-zinc-500">Prices in USD. fast/smart In/Out are per 1M tokens; everything else is per call.</p>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {Object.keys(prices).map((k) => (
            <div key={k}>
              <Label hint={/^(fast|smart)(In|Out)$/.test(k) ? "per 1M tokens" : "per call"}>{k}</Label>
              <Input type="number" min={0} step="any" value={prices[k]} onChange={(e) => setPrices({ ...prices, [k]: e.target.value })} />
            </div>
          ))}
        </div>
      </Section>

      <Section token={token} title="Campaign variables" build={() => {
        const seen = new Set<string>();
        for (const v of vars) {
          if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(v.key)) return `Bad key "${v.key}": letters, digits, underscore; must start with a letter`;
          if (seen.has(v.key)) return `Duplicate key "${v.key}"`;
          seen.add(v.key);
          if (!v.sentence.includes("<<FILL_THIS>>")) return `Variable "${v.key}": sentence must contain <<FILL_THIS>>`;
        }
        return { campaignVariables: vars };
      }}>
        <p className="text-xs text-zinc-500">
          Each variable is filled by Gemini per lead (replacing <code className="text-zinc-300">&lt;&lt;FILL_THIS&gt;&gt;</code> in the sentence, guided by the instructions,
          with the fallback used when nothing fits) and pushed to Instantly as a custom variable with the same key.
        </p>
        {vars.map((v, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-zinc-800 p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1"><Label>Key</Label><Input value={v.key} onChange={(e) => setVar(i, { key: e.target.value })} placeholder="intro_line" /></div>
              <Button size="sm" variant="danger" onClick={() => setVars(vars.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            <div><Label hint="(must contain <<FILL_THIS>>)">Sentence</Label><Input value={v.sentence} onChange={(e) => setVar(i, { sentence: e.target.value })} /></div>
            <div><Label>Instructions</Label><Textarea rows={2} value={v.instructions} onChange={(e) => setVar(i, { instructions: e.target.value })} /></div>
            <div><Label>Fallback</Label><Input value={v.fallback} onChange={(e) => setVar(i, { fallback: e.target.value })} /></div>
          </div>
        ))}
        <Button size="sm" onClick={() => setVars([...vars, { key: "", sentence: "", instructions: "", fallback: "" }])} disabled={vars.length >= 20}>Add variable</Button>
      </Section>
    </div>
  );
}

export default function SettingsPage() {
  const token = useToken();
  const data = useQuery(api.settings.get, { token });
  return (
    <div>
      <PageHeader title="Settings" sub="Rules, thresholds, models and campaign variables. Each section saves on its own." />
      {!data ? <Spinner /> : <Form init={data.settings as unknown as S} keyStatus={data.keyStatus} mock={data.mock} token={token} />}
    </div>
  );
}

function ReviewsImport({ token }: { token: string }) {
  const status = useQuery(api.reviews.status, { token });
  const start = useAction(api.ingest.importReviews);
  const [err, setErr] = useState("");
  const running = status?.state === "running";
  return (
    <Card title="Reviewer names (reviews.csv)" actions={
      <Button size="sm" variant="primary" loading={running} onClick={async () => { setErr(""); try { await start({ token }); } catch (e) { setErr(errMsg(e)); } }}>
        {status ? "Re-import" : "Import"}
      </Button>}>
      <p className="text-xs text-zinc-500">
        Reads <span className="text-zinc-300">reviews.csv</span> from the Drive folder (next to by_state) and keeps up to 3 five-star reviews per company with the
        reviewer&apos;s first name, so the opening line can say &ldquo;I saw Tyler&apos;s review on your Google page…&rdquo;. Free (no AI); takes a few minutes; safe to re-run.
      </p>
      <div className="mt-3 text-sm text-zinc-300">
        {!status ? "Not imported yet." : (
          <>
            <Badge tone={status.state === "done" ? "green" : status.state === "error" ? "red" : "blue"}>{status.state}</Badge>{" "}
            {int(status.rows)} reviews read · {int(status.kept)} kept{status.places ? ` for ${int(status.places)} companies` : ""}
            {status.finishedAt ? ` · finished ${ago(status.finishedAt)}` : status.startedAt ? ` · started ${ago(status.startedAt)}` : ""}
            {status.error && <ErrorText>{status.error}</ErrorText>}
          </>
        )}
      </div>
      <ErrorText>{err}</ErrorText>
    </Card>
  );
}
