// Findymail (find), TryKitt (find + verify), Instantly (verify + campaigns + leads). See knowledge/kb/*.md.
import type { Settings } from "../defaults";
import { env, fail, hash, http, isMock } from "./http";

export type EmailStatus = "valid" | "catch_all" | "risky" | "invalid" | "unknown";

/** Finders return placeholders like "no-results-found" when they have nothing — only real addresses count. */
export const asEmail = (x: unknown): string | null => {
  const s = typeof x === "string" ? x.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : null;
};
const mockEmail = (name: string, domain: string) => `${name.split(" ")[0].toLowerCase()}@${domain}`;

// ---------- Findymail ----------
export async function findymailFind(name: string, domain: string, s: Settings): Promise<{ email: string | null; costUsd: number }> {
  if (isMock()) return hash(name + domain) < 550 ? { email: mockEmail(name, domain), costUsd: s.prices.findymailFound } : { email: null, costUsd: 0 };
  const r = await http("https://app.findymail.com/api/search/name", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("FINDYMAIL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, domain }),
  });
  if (r.status === 404 || r.status === 422) return { email: null, costUsd: 0 }; // not-found shape UNCONFIRMED
  if (r.status !== 200) fail("findymail", r);
  const email = asEmail(r.body?.contact?.email); // credit only charged when found
  return { email, costUsd: email ? s.prices.findymailFound : 0 };
}

// ---------- Bouncer ---------- (kb/bouncer.md)
/** deliverable/risky + acceptAll -> catch_all, so accept-all domains stay tagged; undeliverable -> invalid. */
export function mapBouncer(b: any): EmailStatus {
  const accept = String(b?.domain?.acceptAll ?? "").toLowerCase() === "yes";
  switch (String(b?.status ?? "").toLowerCase()) {
    case "undeliverable": return "invalid";
    case "deliverable": return accept ? "catch_all" : "valid";
    case "risky": return accept ? "catch_all" : "risky";
    default: return "unknown";
  }
}

export async function bouncerVerify(email: string, s: Settings): Promise<{ status: EmailStatus; raw: string; costUsd: number }> {
  if (isMock()) {
    const h = hash(email + "bv");
    return { status: h < 600 ? "valid" : h < 800 ? "catch_all" : "invalid", raw: "mock", costUsd: s.prices.bouncerVerify };
  }
  const r = await http(`https://api.usebouncer.com/v1.1/email/verify?email=${encodeURIComponent(email)}&timeout=20`, {
    headers: { "x-api-key": env("BOUNCER_API_KEY") }, timeoutMs: 45_000,
  });
  if (r.status !== 200) fail("bouncer", r);
  return { status: mapBouncer(r.body), raw: `${r.body?.status}/${r.body?.reason}/acceptAll:${r.body?.domain?.acceptAll}`, costUsd: s.prices.bouncerVerify };
}

// ---------- TryKitt ----------
const kittHeaders = () => ({ "x-api-key": env("TRYKITT_API_KEY"), "Content-Type": "application/json" });

export async function trykittFind(fullName: string, domain: string, linkedin: string, s: Settings): Promise<{ email: string | null; costUsd: number }> {
  if (isMock()) return hash(domain + fullName) < 450 ? { email: mockEmail(fullName, domain), costUsd: s.prices.trykittFound } : { email: null, costUsd: 0 };
  const r = await http("https://api.trykitt.ai/job/find_email", {
    method: "POST", headers: kittHeaders(), timeoutMs: 120_000,
    body: JSON.stringify({ fullName, domain, realtime: true, ...(linkedin ? { linkedinStandardProfileURL: linkedin } : {}) }),
  });
  if (r.status !== 200) fail("trykitt", r);
  const d = r.body?.data ?? r.body?.result ?? r.body; // live 2026-10-08: flat body
  const email = asEmail(d?.botGeneratedEmail) ?? asEmail(d?.email); // "no-results-found" when nothing
  const billed = Number(r.body?.credits?.jobCredits); // TryKitt reports the real cost per job
  return { email, costUsd: Number.isFinite(billed) ? billed : email ? s.prices.trykittFound : 0 };
}

/** TryKitt's verify response schema is UNCONFIRMED (kb/trykitt.md) — map defensively and keep the raw for the step log. */
export function mapKittStatus(body: any): EmailStatus {
  const d = body?.data ?? body?.result ?? body ?? {};
  const fields = [d.status, d.result, d.verification_status, d.verificationStatus, d.emailStatus, d.state, d.validity]
    .filter((x) => typeof x === "string").join(" ").toLowerCase();
  if (/catch.?all|accept.?all/.test(fields) || d.catchAll === true || d.catch_all === true || d.isCatchAll === true) return "catch_all";
  if (/invalid|undeliverable|bounce|not.?valid/.test(fields) || d.valid === false || d.isValid === false) return "invalid";
  if (/risky/.test(fields)) return "risky";
  if (/valid|deliverable|verified/.test(fields) || d.valid === true || d.isValid === true || d.deliverable === true) return "valid";
  return "unknown";
}

export async function trykittVerify(email: string, s: Settings): Promise<{ status: EmailStatus; raw: string; costUsd: number }> {
  if (isMock()) {
    const h = hash(email);
    return { status: h < 600 ? "valid" : h < 850 ? "catch_all" : "invalid", raw: "mock", costUsd: s.prices.trykittVerify };
  }
  const r = await http("https://api.trykitt.ai/job/verify_email", {
    method: "POST", headers: kittHeaders(), timeoutMs: 120_000,
    body: JSON.stringify({ email, realtime: true, treatAliasesAsValid: true }),
  });
  if (r.status !== 200) fail("trykitt", r);
  const billed = Number(r.body?.credits?.jobCredits);
  return { status: mapKittStatus(r.body), raw: JSON.stringify(r.body).slice(0, 400), costUsd: Number.isFinite(billed) ? billed : s.prices.trykittVerify };
}

// ---------- Instantly ----------
const INSTANTLY = "https://api.instantly.ai/api/v2";
const instHeaders = () => ({ Authorization: `Bearer ${env("INSTANTLY_API_KEY")}`, "Content-Type": "application/json" });

function mapInstantly(b: any): EmailStatus {
  if (b?.verification_status === "invalid") return "invalid";
  if (b?.verification_status === "verified") return b.catch_all === true ? "catch_all" : "valid";
  return "unknown"; // pending or anything new
}

/** POST waits up to ~10s, then may return pending → poll GET a few times. */
export async function instantlyVerify(email: string, s: Settings): Promise<{ status: EmailStatus; costUsd: number }> {
  if (isMock()) return { status: hash(email + "i") < 500 ? "valid" : "catch_all", costUsd: s.prices.instantlyVerify };
  let r = await http(`${INSTANTLY}/email-verification`, { method: "POST", headers: instHeaders(), body: JSON.stringify({ email }) });
  if (r.status !== 200) fail("instantly", r);
  for (let i = 0; i < 6 && r.body?.verification_status === "pending"; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    r = await http(`${INSTANTLY}/email-verification/${encodeURIComponent(email)}`, { headers: instHeaders() });
    if (r.status !== 200) fail("instantly", r);
  }
  return { status: mapInstantly(r.body), costUsd: s.prices.instantlyVerify };
}

export async function instantlyCampaigns(): Promise<{ id: string; name: string }[]> {
  if (isMock()) return [{ id: "mock-campaign", name: "Mock campaign" }];
  const out: { id: string; name: string }[] = [];
  let after = "";
  for (let page = 0; page < 20; page++) {
    const r = await http(`${INSTANTLY}/campaigns?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`, { headers: instHeaders() });
    if (r.status !== 200) fail("instantly", r);
    out.push(...(r.body.items ?? []).map((c: any) => ({ id: c.id, name: c.name })));
    after = r.body.next_starting_after;
    if (!after) break;
  }
  return out;
}

export async function instantlyAddLeads(campaignId: string, leads: Record<string, unknown>[]): Promise<{ uploaded: number; skipped: number }> {
  if (isMock()) return { uploaded: leads.length, skipped: 0 };
  const r = await http(`${INSTANTLY}/leads/add`, {
    method: "POST", headers: instHeaders(),
    body: JSON.stringify({ campaign_id: campaignId, leads, skip_if_in_workspace: true, skip_if_in_campaign: true }),
  });
  if (r.status !== 200) fail("instantly", r);
  return { uploaded: r.body.leads_uploaded ?? 0, skipped: (r.body.skipped_count ?? 0) + (r.body.duplicated_leads ?? 0) + (r.body.in_blocklist ?? 0) };
}
