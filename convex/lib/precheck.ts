// Pure helpers for the cheap pre-check (fast model) and the domain-search gate.
export const PRECHECK_REJECT_SEGMENTS = ["vacation", "real_estate_sales", "trade_service", "other"];

/** Reject only when the segment is a clear non-ICP one AND the model is confident enough. */
export const precheckRejects = (segment: string, confidence: number, minConfidence: number) =>
  PRECHECK_REJECT_SEGMENTS.includes(segment) && confidence >= minConfidence;

/** Domain search (paid) only for categories that plausibly are property managers. */
export const domainSearchAllowed = (category: string | undefined, allowed: string[]) => {
  const c = (category ?? "").toLowerCase();
  return allowed.some((a) => a && c.includes(a.toLowerCase()));
};
