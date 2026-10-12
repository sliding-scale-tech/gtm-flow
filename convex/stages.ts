// One function per pipeline stage. Pure orchestration of providers + deterministic rules; no DB access.
// Each returns what to patch and where the lead goes next. The pipeline applies it transactionally.
import type { Doc } from "./_generated/dataModel";
import type { PromptKey, Settings } from "./defaults";
import { isBadHost, parseReviews, rootDomain } from "./lib/text";
import { research } from "./agent";
import { asEmail, bouncerVerify, findymailFind, trykittFind, trykittVerify, type EmailStatus } from "./providers/email";
import { exaSearch, exaSite, type ExaHit } from "./providers/exa";
import { clean, fill, gemini, type Tier } from "./providers/gemini";

import { type Stage } from "./lib/stageList";
import { helpers, num, obj, reject, str, fmtHits, type StageCtx, type StageOut } from "./stageKit";
export type { Stage, StageCtx, StageOut };

// ---------------------------------------------------------------------------

async function domain(c: StageCtx): Promise<StageOut> {
  const { calls, ai, track } = helpers(c);
  const fromCsv = rootDomain(c.lead.website);
  if (fromCsv && !isBadHost(fromCsv)) return { patch: { domain: fromCsv, domainSource: "csv" }, next: "site", calls, summary: `csv: ${fromCsv}` };

  const q = `"${c.lead.name}" ${c.lead.county} ${c.lead.usState} property management`;
  const { hits } = track("exa", await exaSearch(q, c.settings, { numResults: 6 }));
  const out = await ai<{ domain: string; confidence: number; reason: string }>("domain", "fast",
    { results: clean(fmtHits(hits), 9000) }, obj({ domain: str, confidence: num, reason: str }));
  const d = rootDomain(out.domain);
  if (!d || isBadHost(d) || out.confidence < 0.5) return reject(calls, "no_domain", `exa: ${out.reason}`);
  return { patch: { domain: d, domainSource: "exa" }, next: "site", calls, summary: `exa: ${d} (${out.confidence})` };
}

async function site(c: StageCtx): Promise<StageOut> {
  const { calls, ai, track } = helpers(c);
  const url = `https://${c.lead.domain}`;
  let text = "";
  try { text = track("exa", await exaSite(url, c.settings)).text; } catch (e) { /* fall back to Gemini below */ }
  let via = "exa";
  if (text.length < 200) {
    // Fallback: Gemini reads the page itself (URL context tool). No schema: plain text.
    via = "gemini-url";
    text = await ai<string>("site_read", "fast", { url }, undefined, [{ url_context: {} }]);
    // When the page is blocked Gemini answers with an apology instead of page text.
    if (text.length < 800 && /unable to (access|retrieve|read)|cannot (access|retrieve|read)|blocking automated/i.test(text)) text = "";
  }
  if (text.length < 200) return reject(calls, "site_unreadable", `${via}: ${text.length} chars`, { siteOk: false });
  const next = c.lead.isBuilding && !c.lead.building ? "building" : "research";
  return { patch: { siteOk: true }, blob: { siteText: text.slice(0, 30000) }, next, calls, bumps: c.lead.building ? [] : ["site_ok"], summary: `${via}: ${text.length} chars` };
}


/** Apartment/condo listings: find the management company behind the building before researching. */
async function building(c: StageCtx): Promise<StageOut> {
  const { calls, ai } = helpers(c);
  const o = await ai<{ site_owner: string; company_name: string; company_website: string }>("building_check", "fast",
    { site: clean(c.blob?.siteText, 10000) },
    obj({ site_owner: { type: "string", enum: ["management_company", "building", "chain", "unknown"] }, company_name: str, company_website: str }));
  const b = { verdict: o.site_owner, companyName: o.company_name.trim(), companyWebsite: o.company_website.trim() };
  const summary = `${o.site_owner}${b.companyName ? ` → ${b.companyName}` : ""}${b.companyWebsite ? ` (${b.companyWebsite})` : ""}`;
  if (o.site_owner === "chain") return reject(calls, "chain", summary, { building: b });
  if (o.site_owner === "management_company")
    return { patch: { building: b, company: b.companyName || c.lead.name }, next: "research", calls, summary };
  const d = rootDomain(b.companyWebsite);
  if (o.site_owner === "building" && d && !isBadHost(d) && d !== c.lead.domain)
    // Switch to the manager's own site; it gets read next. Same-domain dedupe merges buildings of one manager.
    return { patch: { building: b, company: b.companyName || d, domain: d, domainSource: "building" }, next: "site", calls, summary };
  return reject(calls, o.site_owner === "building" ? "building_only" : "building_unclear", summary, { building: b });
}

/**
 * Email waterfall — ONE single pass, no going back (so it can never loop):
 *   1. TryKitt find  → Bouncer verify → "valid" = save, done
 *   2. Findymail find → TryKitt verify  → "valid" = save, done
 *   3. No valid email but a catch-all/unclear one → save the best one, tagged
 *   4. Nothing usable → reject
 * Never throws for provider trouble: an API error counts as "not verified / not found" and is recorded in the
 * trail, so nothing is retried (and paid) automatically. A missing API key parks the lead as "blocked" with the
 * steps already done saved — resuming continues from there without paying for them again.
 */
type TrailStep = { finder: string; email: string; verifier: string; status: string };
const isMissingKey = (e: unknown) => e instanceof Error && / is not set on the Convex deployment/.test(e.message);
const errText = (e: unknown) => `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;

async function findEmail(c: StageCtx): Promise<StageOut> {
  const { calls, track } = helpers(c);
  const l = c.lead;
  const name = l.owner!.fullName;
  const domain = l.domain!;
  const trail: TrailStep[] = [];
  const rank = (st: string) => (st === "catch_all" ? 2 : st === "risky" ? 1 : 0);
  let best: { email: string; source: string; status: string } | null = null;
  const consider = (email: string, source: string, status: string) => {
    if (email && status !== "valid" && status !== "invalid" && rank(status) > 0 && (!best || rank(status) > rank(best.status))) best = { email, source, status };
  };
  const summary = () => trail.map((t) => `${t.finder}: ${t.email || "not found"}${t.verifier ? ` → ${t.verifier}: ${t.status}` : ` (${t.status})`}`).join(" | ");
  const done = (email: string, source: string, status: string): StageOut => ({
    patch: { email, emailSource: source, emailStatus: status, emailTrail: trail, tried: trail.map((t) => t.finder) },
    next: "personalize", calls, bumps: ["email_found"], summary: summary(),
  });
  const blocked = (e: Error): StageOut => ({ patch: { emailTrail: trail }, next: "blocked", reject: e.message, calls, summary: `${summary()} | waiting: ${e.message}` });
  const verifyStatus = (raw: EmailStatus) => (raw === "unknown" ? "risky" : raw);

  // 1. TryKitt → Bouncer verify (reuse a finished step 1 from before a "blocked" pause — no paying twice)
  const prevRaw = (l.emailTrail ?? []).find((t) => t.finder === "trykitt");
  // Old trails may hold a placeholder like "no-results-found" — treat that as "not found".
  const prev = prevRaw && prevRaw.email && !asEmail(prevRaw.email) ? { finder: "trykitt", email: "", verifier: "", status: "not_found" } : prevRaw;
  let kEmail = "";
  if (prev && (prev.verifier || prev.status === "not_found")) {
    trail.push(prev); // step 1 fully done before the pause
    kEmail = prev.email;
    consider(prev.email, "trykitt", prev.status);
    if (prev.status === "valid") return done(prev.email, "trykitt", "valid");
  } else {
    if (prev?.email) kEmail = prev.email; // found before the pause, only the verify is left
    else try {
      kEmail = (track("trykitt", await trykittFind(name, domain, l.owner!.linkedinUrl, c.settings)).email ?? "").toLowerCase();
    } catch (e) {
      if (isMissingKey(e)) return blocked(e as Error);
      trail.push({ finder: "trykitt", email: "", verifier: "", status: errText(e) });
    }
    if (kEmail) {
      let st: string;
      try { st = verifyStatus(track("bouncer", await bouncerVerify(kEmail, c.settings)).status); }
      catch (e) {
        if (isMissingKey(e)) { trail.push({ finder: "trykitt", email: kEmail, verifier: "", status: "found, not verified yet" }); return blocked(e as Error); }
        st = "risky"; // verifier down → can't confirm → not "valid", try step 2
        trail.push({ finder: "trykitt", email: kEmail, verifier: "bouncer", status: `risky (${errText(e)})` });
      }
      if (!trail.some((t) => t.finder === "trykitt")) trail.push({ finder: "trykitt", email: kEmail, verifier: "bouncer", status: st });
      consider(kEmail, "trykitt", st);
      if (st === "valid") return done(kEmail, "trykitt", "valid");
    } else if (!trail.some((t) => t.finder === "trykitt")) trail.push({ finder: "trykitt", email: "", verifier: "", status: "not_found" });
  }

  // 2. Findymail → TryKitt verify (skip verifying the exact same address again)
  let fEmail = "";
  try { fEmail = (track("findymail", await findymailFind(name, domain, c.settings)).email ?? "").toLowerCase(); }
  catch (e) {
    if (isMissingKey(e)) return blocked(e as Error);
    trail.push({ finder: "findymail", email: "", verifier: "", status: errText(e) });
  }
  if (fEmail && fEmail !== kEmail) {
    let st: string;
    try {
      const kv = track("trykitt", await trykittVerify(fEmail, c.settings));
      st = verifyStatus(kv.status);
      trail.push({ finder: "findymail", email: fEmail, verifier: "trykitt", status: st + (kv.status === "unknown" ? ` (raw ${kv.raw.slice(0, 120)})` : "") });
    } catch (e) {
      st = "risky";
      trail.push({ finder: "findymail", email: fEmail, verifier: "trykitt", status: `risky (${errText(e)})` });
    }
    consider(fEmail, "findymail", st);
    if (st === "valid") return done(fEmail, "findymail", "valid");
  } else if (!trail.some((t) => t.finder === "findymail")) trail.push({ finder: "findymail", email: fEmail, verifier: "", status: fEmail ? "same_as_trykitt" : "not_found" });

  // 3. Only catch-all / unclear emails → keep the best one, tagged.
  const b = best as { email: string; source: string; status: string } | null;
  if (b) return done(b.email, b.source, b.status);
  // 4. Nothing usable.
  const anyFound = trail.some((t) => t.email);
  const out = reject(calls, anyFound ? "invalid_email" : "no_email", summary(),
    { emailTrail: trail, tried: trail.map((t) => t.finder), ...(anyFound ? { emailStatus: "invalid" } : {}) });
  return { ...out, bumps: anyFound ? ["email_found"] : [] };
}

async function personalize(c: StageCtx): Promise<StageOut> {
  const { calls, ai } = helpers(c);
  const site = clean(c.blob?.siteText, 10000);
  // Prefer reviews with a reviewer first name (reviews.csv); fall back to the nameless CSV allReviews.
  const named = c.named ?? [];
  const five = named.length
    ? named.map((r) => `- ${r.author}: ${r.text}`).join("\n")
    : parseReviews(c.lead.reviews).filter((r) => r.stars >= 5).slice(0, 8).map((r) => `- ${r.text}`).join("\n");
  const cvs = c.settings.campaignVariables;

  const [review, desc, label, vars] = await Promise.all([
    five ? ai<{ line: string }>("review_line", "fast", { reviews: clean(five, 4000) }, obj({ line: str })) : Promise.resolve({ line: "" }),
    ai<{ description: string }>("description", "fast", { site }, obj({ description: str })),
    ai<{ label: string }>("service_label", "fast", { site }, obj({ label: str })),
    cvs.length
      ? ai<Record<string, string>>("campaign_vars", "fast", {
          site,
          variables: cvs.map((v) => `- ${v.key}: sentence: "${v.sentence}" | instructions: ${v.instructions} | fallback: "${v.fallback}"`).join("\n"),
        }, obj(Object.fromEntries(cvs.map((v) => [v.key, str]))))
      : Promise.resolve({} as Record<string, string>),
  ]);

  // Deterministic guards on model output (doc 4.3 rules).
  let reviewLine = review.line.trim();
  if (!reviewLine.startsWith("I saw") || !reviewLine.endsWith("I had a question:") || reviewLine.split(/\s+/).length > 30) reviewLine = "";
  // A name in the line must be one of this company's real reviewers (no invented names).
  const usedName = reviewLine.match(/^I saw ([^\s']+)'s review/)?.[1];
  if (usedName && !named.some((r) => r.author === usedName)) reviewLine = "";
  // Email copy must never carry links/addresses planted in a scraped site (prompt injection) — drop such output.
  const noLinks = (t: string) => (/https?:\/\/|www\.|\S+@\S+\.\w|\.(com|net|org|io)\b/i.test(t) ? "" : t);
  if (noLinks(reviewLine) === "") reviewLine = "";
  const description = noLinks(desc.description.trim());
  const serviceLabel = label.label.trim().split(/\s+/).length <= 3 ? noLinks(label.label.trim()) : "";
  const genericLine = serviceLabel ? `I noticed you're selling ${serviceLabel} and I thought I'd reach out.` : "";
  const personal = { reviewLine, description, serviceLabel, genericLine, finalLine: reviewLine || description || genericLine };
  const v: Record<string, string> = {};
  for (const cv of cvs) v[cv.key] = noLinks((vars[cv.key] ?? "").trim().replace(/[.!?,;:]+$/, "")) || cv.fallback;

  return { patch: { personal, vars: v }, next: "ready", calls, summary: personal.finalLine.slice(0, 120) || "no lines" };
}

export const RUNNERS: Record<Stage, (c: StageCtx) => Promise<StageOut>> = {
  // "verify" kept for leads parked there by the old two-step flow; it simply runs the waterfall.
  domain, site, building, research, find_email: findEmail, verify: findEmail, personalize,
};
