/** Provider out-of-money errors: retrying only re-buys paid calls, so the run must pause instead. */
export function quotaError(msg: string): string | null {
  if (/spending cap/i.test(msg)) return "Gemini spending cap reached — raise it in AI Studio (ai.studio/spend), then Resume.";
  if (/exceeded your credits|credits limit|exa HTTP 402/i.test(msg)) return "Exa credits used up — top up at dashboard.exa.ai, then Resume.";
  return null;
}
