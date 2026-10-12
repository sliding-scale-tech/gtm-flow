"use client";
// The 44 columns of the BitScale grid (doc §3), filled from our lead data, plus the columns this build adds.
import type { ReactNode } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import { normalizeCompany, parseReviews } from "@/convex/lib/text";
import { Badge, cx, type Tone } from "@/components/ui";

type Log = { stage: string; summary: string; error?: string; _creationTime: number };
type Src = "CSV" | "Exa" | "Gemini" | "Agent" | "Findymail" | "TryKitt" | "Instantly" | "Formula" | "Dropped";
const srcTone: Record<Src, Tone> = {
  CSV: "zinc", Exa: "blue", Gemini: "violet", Agent: "green", Findymail: "amber", TryKitt: "amber", Instantly: "amber", Formula: "blue", Dropped: "red",
};
type Col = { n: number | string; name: string; src: Src; value: ReactNode; copy?: string; note?: string };

const https = (u?: string) => (u && /^https:\/\//.test(u) ? u : null);
const link = (u?: string) => (https(u) ? <a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-emerald-400 hover:underline">{u}</a> : u ?? "");
const lastLog = (logs: Log[], stage: string) => [...logs].reverse().find((g) => g.stage === stage);

export function EnrichmentGrid({ lead: l, logs, named = [], onCopy }: { lead: Doc<"leads">; logs: Log[]; named?: { author: string; text: string }[]; onCopy: (t: string) => ReactNode }) {
  const site = l.domain ? `https://${l.domain}` : "";
  const five = parseReviews(l.reviews).find((r) => r.stars >= 5);
  const trail = l.emailTrail ?? [];
  const kitt = trail.find((t) => t.finder === "trykitt");
  const fymail = trail.find((t) => t.finder === "findymail");
  const findLog = lastLog(logs, "find_email");
  const researchLog = lastLog(logs, "research");
  const vars = Object.entries(l.vars ?? {});
  const usable = l.emailStatus === "valid" || l.emailStatus === "catch_all";

  const cols: Col[] = [
    // A. Source ingestion
    { n: 1, name: "Google maps url", src: "CSV", value: https(l.mapsUrl) ? <a href={l.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Open in Google Maps ↗</a> : "", copy: l.mapsUrl || undefined },
    { n: 2, name: "Niche Industry", src: "CSV", value: l.category },
    { n: 3, name: "Company Name", src: "CSV", value: l.name, copy: l.name },
    { n: 4, name: "Phone number", src: "CSV", value: l.phone, copy: l.phone },
    { n: 5, name: "Website", src: "CSV", value: link(l.website) || l.website },
    // B. Company cleanup
    { n: 6, name: "Normalize Company name", src: "Formula", value: normalizeCompany(l.company || l.name) },
    { n: 7, name: "Official URL", src: l.domainSource === "csv" ? "CSV" : "Exa", value: l.domainSource ? `${l.domain} (via ${l.domainSource === "exa" ? "Exa search + Gemini" : l.domainSource})` : l.rejectReason === "no_domain" ? "Not found" : "",
      note: "Doc: BitAgent web research. Here: CSV website, else Exa search + Gemini pick." },
    { n: 8, name: "website_url", src: "Formula", value: l.domain ?? "" },
    { n: 9, name: "Final Website url", src: "Formula", value: link(site) },
    // C. Decision-maker research
    { n: 10, name: "Find owner name", src: "Agent", value: researchLog?.summary ?? "", note: "Doc: BitAgent. Here: LangGraph research agent (Gemini + Exa tools)." },
    { n: 11, name: "company_name_matched", src: "Agent", value: l.company || (l.owner?.fullName ? l.name : "") },
    { n: 12, name: "job_title", src: "Agent", value: l.owner?.title ?? "" },
    { n: 13, name: "linkedin_url", src: "Agent", value: link(l.owner?.linkedinUrl) },
    { n: 14, name: "full_name", src: "Agent", value: l.owner?.fullName ?? "", copy: l.owner?.fullName },
    // D. Contact parsing
    { n: 15, name: "First Name", src: "Formula", value: l.owner?.firstName ?? "", copy: l.owner?.firstName },
    { n: 16, name: "Last Name", src: "Formula", value: l.owner?.lastName ?? "", copy: l.owner?.lastName, note: "Fixed: full last name, not only the 2nd word." },
    // E/F. Email discovery + verification
    { n: 17, name: "Trykitt Find Email", src: "TryKitt", value: kitt ? (kitt.email ? "found" : "not found") : "", note: "Step 1 of the email waterfall." },
    { n: 18, name: "Trykitt Email", src: "TryKitt", value: kitt?.email ?? "", copy: kitt?.email || undefined },
    { n: 19, name: "Bouncer Trykitt", src: "Findymail", value: kitt?.verifier ? `${kitt.verifier} verify` : "", note: "Doc: Bouncer. Here: Findymail verifies the TryKitt email (older leads: Instantly)." },
    { n: 20, name: "Status", src: "Findymail", value: kitt?.verifier ? kitt.status : "" },
    { n: 21, name: "Findymail Email", src: "Findymail", value: fymail ? (fymail.email ? (fymail.status === "same_as_trykitt" ? "same as TryKitt" : "found") : "not found") : kitt?.status === "valid" ? "not needed (TryKitt email valid)" : "", note: "Step 2: only if TryKitt had no valid email." },
    { n: 22, name: "Email", src: "Findymail", value: fymail?.email ?? "", copy: fymail?.email || undefined },
    { n: 23, name: "Bouncer findymail", src: "TryKitt", value: fymail?.verifier ? "TryKitt verify" : "", note: "Doc: Bouncer. Here: TryKitt verifies the Findymail email." },
    { n: 24, name: "Status 1", src: "TryKitt", value: fymail?.verifier ? fymail.status : "" },
    { n: 25, name: "Waterfall Find Email", src: "Dropped", value: "Not used", note: "BitScale 18-provider waterfall dropped by decision." },
    { n: 26, name: "Email 1", src: "Dropped", value: "Not used" },
    { n: 27, name: "Bouncer waterfall", src: "Dropped", value: "Not used" },
    { n: 28, name: "Status 2", src: "Dropped", value: "Not used" },
    // G. Final email
    { n: 29, name: "Final verified Email new", src: "Formula", value: usable ? `${l.email} (${l.emailStatus})` : l.emailStatus === "invalid" ? "— (invalid)" : "", copy: usable ? l.email : undefined,
      note: "TryKitt→Findymail verify, then Findymail find→TryKitt verify. Only 'valid' stops the waterfall; if none is valid, the best catch-all is kept, tagged." },
    // H/I. Reviews
    { n: 30, name: "Google Map Review Scraper", src: "CSV",
      value: `${parseReviews(l.reviews).length} reviews in CSV allReviews · ${named.length} named 5★ from reviews.csv`, note: "Doc: Apify. Here: CSV allReviews + reviews.csv (reviewer names)." },
    { n: 31, name: "Name", src: "CSV", value: named[0]?.author ?? "no named 5★ review (import reviews.csv in Settings)", note: "First name only, from reviews.csv." },
    { n: 32, name: "Text", src: "CSV", value: named[0] ? `★5 ${named[0].text}` : five ? `★${five.stars} ${five.text}` : "" },
    { n: 33, name: "Review based 1st line", src: "Gemini", value: l.personal?.reviewLine ?? "" },
    { n: 34, name: "outreach_sentence", src: "Formula", value: l.personal?.reviewLine ?? "", copy: l.personal?.reviewLine || undefined },
    // J. Website enrichment
    { n: 35, name: "Website based 1st line", src: "Gemini", value: l.personal?.description ?? "" },
    { n: 36, name: "company_description", src: "Formula", value: l.personal?.description ?? "", copy: l.personal?.description || undefined },
    // K. Generic fallback
    { n: 37, name: "Generic first line ultimate feedback", src: "Gemini", value: l.personal?.serviceLabel ?? "" },
    { n: 38, name: "Primary Service Label", src: "Formula", value: l.personal?.serviceLabel ?? "" },
    { n: 39, name: "generic_line", src: "Formula", value: l.personal?.genericLine ?? "", copy: l.personal?.genericLine || undefined },
    // L. Final line
    { n: 40, name: "Final Personalized line", src: "Formula", value: l.personal?.finalLine ?? "", copy: l.personal?.finalLine || undefined },
    // M. Campaign variables
    { n: 41, name: "AI variable 1", src: "Gemini", value: vars[0] ? `${vars[0][0]}` : "", note: "Editable in Settings → Campaign variables." },
    { n: 42, name: "Variable 1", src: "Formula", value: vars[0]?.[1] ?? "", copy: vars[0]?.[1] },
    { n: 43, name: "AI variable 2", src: "Gemini", value: vars[1] ? `${vars[1][0]}` : "" },
    { n: 44, name: "Variable2", src: "Formula", value: vars[1]?.[1] ?? "", copy: vars[1]?.[1] },
  ];

  const added: Col[] = [
    { n: "+", name: "Building check", src: "Gemini", value: l.isBuilding ? (l.building ? `${l.building.verdict}${l.building.companyName ? ` → ${l.building.companyName}` : ""}${l.building.companyWebsite ? ` (${l.building.companyWebsite})` : ""}` : "pending") : "not a building listing" },
    { n: "+", name: "Website text", src: "Exa", value: l.siteOk == null ? "" : l.siteOk ? "read (see Details → Website text)" : "unreadable" },
    { n: "+", name: "Segment", src: "Agent", value: l.classify?.segment ?? "" },
    { n: "+", name: "Property manager?", src: "Agent", value: l.classify ? String(l.classify.isPropertyManager) : "" },
    { n: "+", name: "Independent?", src: "Agent", value: l.classify ? String(l.classify.isIndependent) : "" },
    { n: "+", name: "Company size", src: "Agent", value: l.classify?.estSize ?? "" },
    { n: "+", name: "Classification reasoning", src: "Agent", value: l.classify?.reasoning ?? "" },
    { n: "+", name: "Owner confidence", src: "Agent", value: l.owner ? String(l.owner.confidence) : "" },
    { n: "+", name: "Owner source", src: "Agent", value: link(l.owner?.sourceUrl) },
    { n: "+", name: "Go / no-go", src: "Agent", value: l.decision ? `${l.decision.decision}${l.decision.failedGates.length ? ` · failed gates: ${l.decision.failedGates.join(", ")}` : ""}\n${l.decision.reasons.join("\n")}` : "" },
    { n: "+", name: "Agent tool calls", src: "Agent", value: (l.agentTrace ?? []).map((t) => `${t.ok ? "✓" : "✗"} ${t.tool} ${t.input}`).join("\n") || (l.classify ? "none (website was enough)" : "") },
    ...vars.slice(2).map(([k, v]) => ({ n: "+", name: k, src: "Gemini" as Src, value: v, copy: v })),
    { n: "+", name: "Email waterfall trail", src: "Formula", value: trail.map((t, i) => `${i + 1}. ${t.finder}: ${t.email || "not found"}${t.verifier ? ` → ${t.verifier}: ${t.status}` : ""}`).join("\n") || findLog?.error || "" },
  ];

  const table = (rows: Col[]) => (
    <table className="w-full table-fixed text-xs">
      <colgroup><col className="w-8" /><col className="w-44" /><col className="w-20" /><col /><col className="w-12" /></colgroup>
      <tbody>
        {rows.map((c, i) => (
          <tr key={`${c.n}-${c.name}-${i}`} className={cx("border-b border-zinc-800/70 align-top", c.src === "Dropped" && "opacity-50")}>
            <td className="py-1.5 pr-2 tabular text-zinc-600">{c.n}</td>
            <td className="py-1.5 pr-2 text-zinc-400" title={c.note}>{c.name}{c.note && <span className="ml-1 text-zinc-600">ⓘ</span>}</td>
            <td className="py-1.5 pr-2"><Badge tone={srcTone[c.src]}>{c.src}</Badge></td>
            <td className="whitespace-pre-wrap break-words py-1.5 pr-2 text-zinc-200">{c.value || <span className="text-zinc-600">—</span>}</td>
            <td className="py-1.5 text-right">{c.copy ? onCopy(c.copy) : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">BitScale grid · 44 columns (doc order)</h3>
        <p className="mb-2 text-[11px] text-zinc-600">Hover ⓘ for how a column differs from the doc. Empty = that step hasn't run for this lead yet.</p>
        {table(cols)}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Added in this build</h3>
        {table(added)}
      </div>
    </div>
  );
}
