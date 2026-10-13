import type { Settings } from "../defaults";
import { env, fail, hash, http, isMock } from "./http";
import { trimSite } from "../lib/text";

export type ExaHit = { title: string; url: string; text: string };
const headers = () => ({ "x-api-key": env("EXA_API_KEY"), "Content-Type": "application/json" });

export async function exaSearch(
  query: string, s: Settings, opts: { numResults?: number; category?: string; maxChars?: number } = {},
): Promise<{ hits: ExaHit[]; costUsd: number }> {
  if (isMock()) return { hits: [{ title: query, url: `https://example.com/${hash(query)}`, text: `mock result for ${query}` }], costUsd: s.prices.exaSearch };
  const r = await http("https://api.exa.ai/search", {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      query, type: s.exaSearchType, numResults: opts.numResults ?? 5,
      ...(opts.category ? { category: opts.category } : {}),
      contents: { text: { maxCharacters: opts.maxChars ?? 1200 } },
    }),
  });
  if (r.status !== 200) fail("exa", r);
  const hits = (r.body.results ?? []).map((x: any) => ({ title: x.title ?? "", url: x.url ?? "", text: x.text ?? "" }));
  return { hits, costUsd: r.body.costDollars?.total ?? s.prices.exaSearch };
}

/** Homepage + about/team/contact subpages as one text blob. Empty text = unreadable. */
export async function exaSite(url: string, s: Settings): Promise<{ text: string; costUsd: number }> {
  if (isMock()) {
    const h = hash(url);
    return { text: h < 900 ? `Welcome to ${url}. We provide full-service property management for owners. About us: founded by our owner. Team: Jane Smith, Owner. Contact us.`.repeat(3) : "", costUsd: s.prices.exaPage * 4 };
  }
  const r = await http("https://api.exa.ai/contents", {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      urls: [url], text: { maxCharacters: 6000 }, subpages: 4,
      subpageTarget: ["about", "team", "staff", "leadership", "contact"], livecrawlTimeout: 15000,
    }),
    timeoutMs: 90_000,
  });
  if (r.status !== 200) fail("exa", r);
  const parts: string[] = [];
  for (const res of r.body.results ?? []) {
    if (res.text) parts.push(`### ${res.url}\n${res.text}`);
    for (const sp of res.subpages ?? []) if (sp.text) parts.push(`### ${sp.url}\n${sp.text}`);
  }
  return { text: trimSite(parts.join("\n\n")), costUsd: r.body.costDollars?.total ?? s.prices.exaPage * (1 + 4) };
}
