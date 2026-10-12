// Email waterfall scenarios with faked providers: TryKitt→Bouncer, then Findymail→TryKitt verify, single pass.
import { beforeEach, describe, expect, it, vi } from "vitest";

const p = vi.hoisted(() => ({
  trykittFind: vi.fn(), bouncerVerify: vi.fn(), findymailFind: vi.fn(), trykittVerify: vi.fn(),
}));
vi.mock("../providers/email", async (orig) => ({ ...(await orig<object>()), ...p })); // real helpers, fake API calls
vi.mock("../agent", () => ({ research: vi.fn() }));

import { RUNNERS } from "../stages";
import { mapBouncer } from "../providers/email";
import { DEFAULT_SETTINGS } from "../defaults";

const lead = { owner: { fullName: "Jane Smith", linkedinUrl: "" }, domain: "acme.com" } as any;
const run = (l: any = lead) => RUNNERS.find_email({ lead: l, blob: null, settings: DEFAULT_SETTINGS, prompts: {} as any });
const missing = (k: string) => new Error(`${k} is not set on the Convex deployment`);
const found = (email: string | null) => ({ email, costUsd: email ? 0.01 : 0 });
const verified = (status: string) => ({ status, raw: "", costUsd: 0.001 });
const reset = () => Object.values(p).forEach((f) => f.mockReset());

describe("email waterfall", () => {
  beforeEach(reset);

  it("TryKitt email valid on Bouncer → done, Findymail never called", async () => {
    p.trykittFind.mockResolvedValue(found("Jane@acme.com"));
    p.bouncerVerify.mockResolvedValue(verified("valid"));
    const o = await run();
    expect(o.next).toBe("personalize");
    expect(o.patch).toMatchObject({ email: "jane@acme.com", emailSource: "trykitt", emailStatus: "valid" });
    expect(p.findymailFind).not.toHaveBeenCalled();
  });

  it("TryKitt email invalid → Findymail → TryKitt verify valid → done", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockResolvedValue(verified("invalid"));
    p.findymailFind.mockResolvedValue(found("j.smith@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("valid"));
    const o = await run();
    expect(o.patch).toMatchObject({ email: "j.smith@acme.com", emailSource: "findymail", emailStatus: "valid" });
    expect(o.patch.emailTrail).toHaveLength(2);
  });

  it("TryKitt not found → Findymail found → valid", async () => {
    p.trykittFind.mockResolvedValue(found(null));
    p.findymailFind.mockResolvedValue(found("jane@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("valid"));
    const o = await run();
    expect(o.patch).toMatchObject({ emailSource: "findymail", emailStatus: "valid" });
    expect(p.bouncerVerify).not.toHaveBeenCalled();
  });

  it("only catch-all available → keeps the best one, tagged", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockResolvedValue(verified("catch_all"));
    p.findymailFind.mockResolvedValue(found("j@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("invalid"));
    const o = await run();
    expect(o.next).toBe("personalize");
    expect(o.patch).toMatchObject({ email: "jane@acme.com", emailSource: "trykitt", emailStatus: "catch_all" });
  });

  it("catch-all beats risky when choosing the fallback", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockResolvedValue(verified("unknown")); // → risky
    p.findymailFind.mockResolvedValue(found("j@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("catch_all"));
    const o = await run();
    expect(o.patch).toMatchObject({ email: "j@acme.com", emailStatus: "catch_all" });
  });

  it("nothing found anywhere → rejected no_email", async () => {
    p.trykittFind.mockResolvedValue(found(null));
    p.findymailFind.mockResolvedValue(found(null));
    const o = await run();
    expect(o).toMatchObject({ next: "rejected", reject: "no_email" });
  });

  it("Findymail returns the same invalid address → not re-verified, rejected invalid_email", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockResolvedValue(verified("invalid"));
    p.findymailFind.mockResolvedValue(found("JANE@acme.com"));
    const o = await run();
    expect(o).toMatchObject({ next: "rejected", reject: "invalid_email" });
    expect(p.trykittVerify).not.toHaveBeenCalled();
  });

  it("each finder runs at most once (max 3 finds + 3 verifies), never goes back a stage", async () => {
    p.trykittFind.mockResolvedValue(found("a@acme.com"));
    p.bouncerVerify.mockResolvedValue(verified("invalid"));
    p.findymailFind.mockResolvedValue(found("b@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("invalid"));
    const o = await run();
    expect(p.trykittFind).toHaveBeenCalledTimes(1);
    expect(p.findymailFind).toHaveBeenCalledTimes(1);
    expect(p.bouncerVerify).toHaveBeenCalledTimes(1);
    expect(p.trykittVerify).toHaveBeenCalledTimes(1);
    expect(["personalize", "rejected"]).toContain(o.next);
  });

  it("Bouncer server error → not 'valid', moves on to Findymail (no crash, no retry)", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockRejectedValue(new Error("findymail HTTP 500: Something went wrong"));
    p.findymailFind.mockResolvedValue(found("j.smith@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("valid"));
    const o = await run();
    expect(o.patch).toMatchObject({ email: "j.smith@acme.com", emailSource: "findymail", emailStatus: "valid" });
    expect(o.calls.length).toBe(3); // trykitt find + findymail find + trykitt verify (findymail threw, nothing billed)
  });

  it("Bouncer error and no Findymail email → keeps TryKitt email as 'risky'", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockRejectedValue(new Error("findymail HTTP 500"));
    p.findymailFind.mockResolvedValue(found(null));
    const o = await run();
    expect(o.patch).toMatchObject({ email: "jane@acme.com", emailStatus: "risky" });
  });

  it("Findymail key missing → blocked, TryKitt step saved; resume doesn't pay TryKitt again", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockResolvedValue(verified("invalid"));
    p.findymailFind.mockRejectedValue(missing("FINDYMAIL_API_KEY"));
    const o = await run();
    expect(o.next).toBe("blocked");
    expect(o.patch.emailTrail).toEqual([
      { finder: "trykitt", email: "jane@acme.com", verifier: "bouncer", status: "invalid" },
    ]);
    // resume with the saved trail
    reset();
    p.findymailFind.mockResolvedValue(found("j.smith@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("valid"));
    const o2 = await run({ ...lead, emailTrail: o.patch.emailTrail });
    expect(p.trykittFind).not.toHaveBeenCalled();
    expect(p.bouncerVerify).not.toHaveBeenCalled();
    expect(o2.patch).toMatchObject({ email: "j.smith@acme.com", emailStatus: "valid" });
  });

  it("Bouncer key missing after TryKitt found → blocked; resume only verifies", async () => {
    p.trykittFind.mockResolvedValue(found("jane@acme.com"));
    p.bouncerVerify.mockRejectedValue(missing("BOUNCER_API_KEY"));
    const o = await run();
    expect(o.next).toBe("blocked");
    reset();
    p.bouncerVerify.mockResolvedValue(verified("valid"));
    const o2 = await run({ ...lead, emailTrail: o.patch.emailTrail });
    expect(p.trykittFind).not.toHaveBeenCalled();
    expect(o2.patch).toMatchObject({ email: "jane@acme.com", emailSource: "trykitt", emailStatus: "valid" });
  });

  it('TryKitt placeholder "no-results-found" counts as not found (never sent to Bouncer)', async () => {
    p.trykittFind.mockResolvedValue(found(null));
    p.findymailFind.mockRejectedValue(missing("FINDYMAIL_API_KEY"));
    const o = await run();
    expect(p.bouncerVerify).not.toHaveBeenCalled();
    expect(o.next).toBe("blocked");
    // an old trail holding the placeholder is treated as "not found" on resume
    reset();
    p.findymailFind.mockResolvedValue(found("jane@acme.com"));
    p.trykittVerify.mockResolvedValue(verified("valid"));
    const o2 = await run({ ...lead, emailTrail: [{ finder: "trykitt", email: "no-results-found", verifier: "bouncer", status: "risky" }] });
    expect(p.trykittFind).not.toHaveBeenCalled();
    expect(p.bouncerVerify).not.toHaveBeenCalled();
    expect(o2.patch).toMatchObject({ email: "jane@acme.com", emailSource: "findymail", emailStatus: "valid" });
  });

  it("maps Bouncer: undeliverable=invalid; deliverable/risky on an accept-all domain=catch_all", () => {
    expect(mapBouncer({ status: "deliverable", domain: { acceptAll: "no" } })).toBe("valid");
    expect(mapBouncer({ status: "deliverable", domain: { acceptAll: "yes" } })).toBe("catch_all");
    expect(mapBouncer({ status: "risky", domain: { acceptAll: "yes" } })).toBe("catch_all");
    expect(mapBouncer({ status: "risky", domain: { acceptAll: "no" } })).toBe("risky");
    expect(mapBouncer({ status: "undeliverable" })).toBe("invalid");
    expect(mapBouncer({ status: "unknown" })).toBe("unknown");
    expect(mapBouncer({})).toBe("unknown");
  });
});
