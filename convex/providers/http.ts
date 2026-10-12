export const isMock = () => process.env.PIPELINE_MOCK === "1";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set on the Convex deployment`);
  return v;
}

const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch + JSON with retry/backoff on 429/5xx and network errors. Returns every final status; callers decide. */
export async function http(url: string, init: RequestInit & { timeoutMs?: number } = {}, retries = 3): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 60_000) });
      const text = await res.text();
      let body: any = text;
      try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
      if (RETRY.has(res.status) && attempt < retries) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(after > 0 ? Math.min(after, 30) * 1000 : 1000 * 2 ** attempt + Math.random() * 500);
        continue;
      }
      return { status: res.status, body };
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export function fail(provider: string, r: { status: number; body: unknown }): never {
  const msg = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  throw new Error(`${provider} HTTP ${r.status}: ${msg.slice(0, 300)}`);
}

/** Stable small hash for deterministic mock data. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}
