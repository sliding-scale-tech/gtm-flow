// Research agent (LangGraph via langchain v1 `createAgent` + Gemini `ChatGoogle`). Node-only: imported by worker.ts.
// One agent per lead answers: real independent PM? who is the owner? should we pay for the email?
// It may call up to `settings.agentMaxTools` Exa-backed tools; the deterministic hard gates run after it.
import { createAgent, tool } from "langchain";
import { ChatGoogle } from "@langchain/google";
import * as z from "zod";
import { failedGates } from "./lib/rules";
import { splitName } from "./lib/text";
import { exaSearch, exaSite } from "./providers/exa";
import { precheckRejects } from "./lib/precheck";
import { clean, fill, gemini, SYSTEM } from "./providers/gemini";
import { env, hash, isMock } from "./providers/http";
import { fmtHits, reject, reviewSample, type Call, type StageCtx, type StageOut } from "./stageKit";

const SEGMENTS = ["residential", "hoa", "commercial", "vacation", "trade_service", "real_estate_sales", "other"] as const;

// Flat schema — Gemini rejects deeply nested tool/response schemas.
const Out = z.object({
  segment: z.enum(SEGMENTS),
  is_property_manager: z.boolean(),
  is_independent: z.boolean(),
  est_size: z.enum(["1-10", "11-50", "51-200", "200+", "unknown"]),
  classification_confidence: z.number().describe("0-1"),
  classification_reasoning: z.string().describe("max 2 sentences"),
  owner_full_name: z.string().describe("empty if none confirmed"),
  owner_title: z.string(),
  owner_linkedin_url: z.string().describe("https://www.linkedin.com/in/... seen in evidence, else empty"),
  owner_source_url: z.string(),
  owner_confidence: z.number().describe("0-1"),
  decision: z.enum(["find_email", "skip"]),
  reasons: z.array(z.string()).describe("1-3 short reasons"),
});
type Research = z.infer<typeof Out>;
type Trace = { tool: string; input: string; ok: boolean };

export async function research(c: StageCtx): Promise<StageOut> {
  const l = c.lead;
  const calls: Call[] = c.calls ?? [];
  const trace: Trace[] = [];
  const max = c.settings.agentMaxTools;
  const company = l.company || l.name;

  if (c.settings.precheck && !isMock()) {
    const r = await gemini<{ segment: string; confidence: number; reason: string }>({
      tier: "fast", settings: c.settings, mockKey: "precheck", mockSeed: l.name,
      prompt: fill(c.prompts.precheck, { name: company, category: l.category, site: clean(c.blob?.siteText, 6000) }),
      schema: { type: "object", properties: { segment: { type: "string", enum: [...SEGMENTS] }, confidence: { type: "number" }, reason: { type: "string" } }, required: ["segment", "confidence", "reason"] },
    });
    calls.push({ provider: "gemini", costUsd: r.costUsd, ...(r.tokens ? { tokens: r.tokens } : {}) });
    const pc = r.data;
    if (precheckRejects(pc.segment, pc.confidence, c.settings.precheckMinConfidence)) {
      const classify = { segment: pc.segment, isPropertyManager: pc.segment === "vacation", isIndependent: true, estSize: "unknown", confidence: pc.confidence, reasoning: pc.reason };
      return reject(calls, `not_icp:${pc.segment}`, `precheck: ${pc.segment} (${pc.confidence}) ${pc.reason}`.slice(0, 300), { classify, agentTrace: [] });
    }
  }

  let out: Research;
  if (isMock()) out = mockResearch(company);
  else {
    let used = 0;
    // Our own cap (graceful): past the budget, tools tell the agent to answer with what it has.
    const guarded = <A,>(name: string, fn: (a: A) => Promise<string>) => async (a: A) => {
      if (used >= max) { trace.push({ tool: name, input: JSON.stringify(a).slice(0, 200), ok: false }); return "Tool budget used up. Give your final answer now with the evidence you have."; }
      used++;
      try { const r = await fn(a); trace.push({ tool: name, input: JSON.stringify(a).slice(0, 200), ok: true }); return r; }
      catch (e) { trace.push({ tool: name, input: JSON.stringify(a).slice(0, 200), ok: false }); return `Tool error: ${e instanceof Error ? e.message.slice(0, 200) : "failed"}`; }
    };
    const tools = [
      tool(guarded("web_search", async ({ query }: { query: string }) => {
        const r = await exaSearch(query, c.settings, { numResults: 5, maxChars: 900 });
        calls.push({ provider: "exa", costUsd: r.costUsd });
        return clean(fmtHits(r.hits), 6000) || "No results.";
      }), { name: "web_search", description: "Search the web. Use for the company's owner/founder, news, BBB or state business records.", schema: z.object({ query: z.string() }) }),
      tool(guarded("search_people", async ({ query }: { query: string }) => {
        const r = await exaSearch(query, c.settings, { numResults: 5, maxChars: 700, category: "people" });
        calls.push({ provider: "exa", costUsd: r.costUsd });
        return clean(fmtHits(r.hits), 6000) || "No results.";
      }), { name: "search_people", description: "Search people profiles (e.g. LinkedIn) — e.g. '<company> owner <city>'.", schema: z.object({ query: z.string() }) }),
      tool(guarded("read_page", async ({ url }: { url: string }) => {
        if (!/^https:\/\//i.test(url)) return "Only https:// URLs can be read.";
        const r = await exaSite(url, c.settings);
        calls.push({ provider: "exa", costUsd: r.costUsd });
        return clean(r.text, 8000) || "Page could not be read.";
      }), { name: "read_page", description: "Read one web page (and a few of its subpages) as text.", schema: z.object({ url: z.string() }) }),
    ];

    const model = new ChatGoogle({
      model: c.settings.models.smart, apiKey: env("GEMINI_API_KEY"), temperature: 0.1, maxOutputTokens: 4096,
      thinkingLevel: "low", maxRetries: 2,
    } as ConstructorParameters<typeof ChatGoogle>[0]);
    const agent = createAgent({ model, tools, systemPrompt: SYSTEM, responseFormat: Out });

    const buildingNote = l.isBuilding
      ? `\nNote: this lead came from an apartment/condo building listing ("${l.name}"). Research the management company behind it (${company}), not the building.`
      : "";
    const prompt = fill(c.prompts.research, {
      company, category: l.category, city: l.county, state: l.usState, domain: l.domain, building_note: buildingNote,
      max_tools: max, site: clean(c.blob?.siteText, 12000), reviews: clean(reviewSample(l.reviews), 2500),
    });

    const result: any = await agent.invoke({ messages: [{ role: "user", content: prompt }] }, { recursionLimit: 2 * max + 8 });
    let structured = result.structuredResponse as Research | undefined;
    const p = c.settings.prices;
    const priceTokens = (msgs: any[]): Call => {
      const t = { in: 0, cached: 0, out: 0, think: 0 };
      let usd = 0;
      for (const m of msgs) {
        const u = m?.usage_metadata; if (!u) continue;
        const cached = u.input_token_details?.cache_read ?? 0, think = u.output_token_details?.reasoning ?? 0; // LangChain output_tokens includes thoughts
        const inn = Math.max(0, (u.input_tokens ?? 0) - cached), out = Math.max(0, (u.output_tokens ?? 0) - think);
        usd += (inn * p.smartIn + cached * p.smartCached + (out + think) * p.smartOut) / 1e6;
        t.in += inn; t.cached += cached; t.out += out; t.think += think;
      }
      return { provider: "gemini", costUsd: usd, tokens: t };
    };
    calls.push(priceTokens(result.messages ?? []));
    if (!structured) {
      // Fallback: extract the answer from the transcript with one structured call.
      const fix: any = await model.withStructuredOutput(Out, { includeRaw: true }).invoke([
        ...(result.messages ?? []),
        { role: "user", content: "Give your final answer in the required structure now." },
      ]);
      structured = fix.parsed as Research;
      calls.push(priceTokens([fix.raw]));
    }
    out = Out.parse(structured);
  }

  // ---- map to lead fields + deterministic hard gates (model output can't skip these) ----
  const classify = {
    segment: out.segment, isPropertyManager: out.is_property_manager, isIndependent: out.is_independent,
    estSize: out.est_size, confidence: out.classification_confidence, reasoning: out.classification_reasoning,
  };
  const { first, last } = splitName(out.owner_full_name);
  const li = out.owner_linkedin_url.trim();
  const owner = {
    fullName: [first, last].filter(Boolean).join(" "), firstName: first, lastName: last, title: out.owner_title.trim(),
    linkedinUrl: /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/.test(li) ? li : "",
    sourceUrl: out.owner_source_url, confidence: out.owner_confidence,
  };
  const reasons = out.reasons.slice(0, 5);
  const tools = trace.length ? ` · tools: ${trace.map((t) => t.tool).join(", ")}` : "";
  const summary = `${out.segment} pm=${out.is_property_manager} indep=${out.is_independent} · ${owner.fullName || "no owner"}${owner.title ? ` (${owner.title})` : ""} · ${out.decision}${tools}`;
  const patch = { classify, owner, agentTrace: trace };
  const icpOk = out.is_property_manager && c.settings.icpSegments.includes(out.segment) && out.is_independent;
  const ownerOk = !!first && out.owner_confidence >= c.settings.minOwnerConfidence;
  const bumps = [...(icpOk ? ["icp"] : []), ...(icpOk && ownerOk ? ["owner"] : [])];

  const done = (o: StageOut): StageOut => ({ ...o, calls, bumps });
  if (!out.is_property_manager || !c.settings.icpSegments.includes(out.segment)) return done(reject(calls, `not_icp:${out.segment}`, summary, patch));
  if (!out.is_independent) return done(reject(calls, "not_independent", summary, patch));
  if (!ownerOk) return done(reject(calls, "no_owner", summary, patch));
  const failed = failedGates({
    segment: out.segment, isPropertyManager: out.is_property_manager, isIndependent: out.is_independent,
    domain: l.domain, siteOk: l.siteOk, ownerName: owner.fullName, ownerTitle: owner.title, estSize: out.est_size,
  }, c.settings);
  if (failed.length)
    return done(reject(calls, `gate:${failed.join(",")}`, summary, { ...patch, decision: { decision: "skip", reasons: [`Hard gates failed: ${failed.join(", ")}`], failedGates: failed } }));
  const decision = { decision: out.decision, reasons, failedGates: [] as string[] };
  if (out.decision !== "find_email") return done(reject(calls, "agent_skip", summary, { ...patch, decision }));
  return done({ patch: { ...patch, decision }, next: "find_email", calls, summary });
}

function mockResearch(seed: string): Research {
  const h = hash(seed);
  const seg = SEGMENTS[[0, 0, 0, 1, 1, 2, 3, 4, 5, 6][h % 10]];
  const hasOwner = h % 100 < 70;
  return {
    segment: seg, is_property_manager: ["residential", "hoa", "commercial", "vacation"].includes(seg), is_independent: h % 10 !== 0,
    est_size: "1-10", classification_confidence: 0.85, classification_reasoning: `mock: ${seg}`,
    owner_full_name: hasOwner ? ["Jane Smith", "Robert Lee Jr.", "Maria de la Cruz"][h % 3] : "", owner_title: hasOwner ? ["Owner", "Founder", "CEO"][h % 3] : "",
    owner_linkedin_url: "", owner_source_url: "", owner_confidence: hasOwner ? 0.8 : 0,
    decision: h % 10 < 9 ? "find_email" : "skip", reasons: ["mock"],
  };
}
