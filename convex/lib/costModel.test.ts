import { describe, expect, it } from "vitest";
import { buildModel, type RunLite } from "./costModel";

const run = (over: Partial<RunLite> & { counts: Record<string, number> }): RunLite => ({
  id: "r", name: "X.csv", status: "done", startedAt: 0, spentUsd: 0, costs: {}, ...over,
});

const big = run({
  id: "big", name: "TX.csv", startedAt: 1000, finishedAt: 1000 + 75 * 60000, spentUsd: 16, costs: { exa: 9, gemini: 5, findymail: 2 },
  counts: {
    "in:domain": 1000, "in:site": 800, "in:research": 500, "in:find_email": 80, ready: 60, "email:valid": 30, "email:catch_all": 20, "email:risky": 10,
    "rej:no_domain": 120, "rej:not_icp": 380, "rej:no_owner": 20, "rej:no_email": 20, dup: 80,
    "c:stage:research:exa": 5, "c:stage:research:gemini": 4, "c:stage:domain:exa": 1,
    "c:out:rej:not_icp": 7, "c:out:email:valid": 2, "c:out:email:catch_all": 1.5, "src:trykitt": 40, "src:findymail": 10,
  },
});
const small = run({ id: "s", name: "NY.csv", spentUsd: 4, costs: { exa: 2, gemini: 2 }, counts: { "in:domain": 100, "email:valid": 10, "email:catch_all": 2 } });

describe("cost model", () => {
  const m = buildModel([big, small]);

  it("adds up spend, providers and usable emails", () => {
    expect(m.spent).toBe(20);
    expect(m.providers.map((p) => p.key)).toEqual(["exa", "gemini", "findymail"]);
    expect(m.usable).toBe(62);
    expect(m.risky).toBe(10);
  });

  it("uses the biggest run as the baseline and the rest as scenario B", () => {
    expect(m.base?.name).toBe("TX.csv");
    expect(m.scenA).toMatchObject({ leads: 1000, usable: 50 });
    expect(m.scenA!.cost).toBeCloseTo(0.016);
    expect(m.scenA!.yld).toBeCloseTo(0.05);
    expect(m.scenB).toMatchObject({ leads: 100, usable: 12 });
  });

  it("skips scenario B when the other runs are too small to mean anything", () => {
    expect(buildModel([big, run({ counts: { "in:domain": 5 } })]).scenB).toBeNull();
  });

  it("derives speed from a finished baseline run", () => {
    expect(m.speed).toBe(800); // 1000 leads in 75 minutes
  });

  it("groups stage costs and outcome costs", () => {
    expect(m.stages[0]).toMatchObject({ label: "Research agent", total: 9 });
    const notIcp = m.outcomes.find((o) => o.key === "rej:not_icp")!;
    expect(notIcp).toMatchObject({ label: "Not a target type", n: 380, cost: 7 });
    expect(notIcp.avg).toBeCloseTo(7 / 380);
    expect(m.outcomes.find((o) => o.key === "email:valid")!.usable).toBe(true);
    expect(m.finders).toEqual([{ key: "trykitt", n: 40 }, { key: "findymail", n: 10 }]);
  });

  it("funnel drops add up (leftover shown as other)", () => {
    expect(m.funnel.map((f) => f.n)).toEqual([1000, 800, 500, 80, 60, 50]);
    expect(m.funnel[1].drop).toEqual({ n: 200, text: "120 no website found, 80 other (mostly duplicate companies)" });
    expect(m.funnel[3].drop!.n).toBe(420);
  });

  it("handles no runs at all", () => {
    const e = buildModel([]);
    expect(e.spent).toBe(0);
    expect(e.base).toBeNull();
    expect(e.funnel).toEqual([]);
  });
});
