import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const leadState = v.union(
  v.literal("queued"), v.literal("working"), v.literal("done"),
  v.literal("rejected"), v.literal("duplicate"), v.literal("error"),
  v.literal("blocked"), // waiting for a missing API key; resumed on Resume
);

export const classifyV = v.object({
  segment: v.string(), isPropertyManager: v.boolean(), isIndependent: v.boolean(),
  estSize: v.string(), confidence: v.number(), reasoning: v.string(),
});
export const ownerV = v.object({
  fullName: v.string(), firstName: v.string(), lastName: v.string(), title: v.string(),
  linkedinUrl: v.string(), sourceUrl: v.string(), confidence: v.number(),
});
export const decisionV = v.object({ decision: v.string(), reasons: v.array(v.string()), failedGates: v.array(v.string()) });
export const personalV = v.object({
  reviewLine: v.string(), description: v.string(), serviceLabel: v.string(), genericLine: v.string(), finalLine: v.string(),
});

export default defineSchema({
  // pwTag ties a session to the current APP_PASSWORD: changing the password logs every session out.
  sessions: defineTable({ tokenHash: v.string(), expiresAt: v.number(), pwTag: v.optional(v.string()) }).index("by_hash", ["tokenHash"]),
  loginAttempts: defineTable({ windowStart: v.number(), count: v.number() }),

  // Single doc; merged over DEFAULT_SETTINGS in code.
  settings: defineTable({ data: v.any() }),
  prompts: defineTable({ key: v.string(), version: v.number(), text: v.string(), active: v.boolean(), createdAt: v.number() })
    .index("by_key", ["key", "version"]),

  runs: defineTable({
    fileName: v.string(),
    source: v.string(), // "drive" | "upload"
    status: v.union(v.literal("ingesting"), v.literal("running"), v.literal("paused"), v.literal("stopped"), v.literal("done"), v.literal("error")),
    pauseReason: v.optional(v.string()),
    budgetUsd: v.number(),
    spentUsd: v.number(),
    costs: v.record(v.string(), v.number()), // provider -> usd
    counts: v.record(v.string(), v.number()), // "in:<stage>", "rej:<reason>", "email:<status>", "rows", "dup"
    rowsTotal: v.number(),
    tickAt: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }),

  leads: defineTable({
    runId: v.id("runs"),
    state: leadState,
    stage: v.string(), // next stage to run, or "ready"
    rejectReason: v.optional(v.string()),
    duplicateOf: v.optional(v.id("leads")),
    // source row
    placeId: v.string(),
    name: v.string(),
    category: v.string(),
    address: v.string(),
    phone: v.string(),
    website: v.string(),
    rating: v.optional(v.number()),
    reviewsCount: v.optional(v.number()),
    county: v.string(),
    usState: v.string(),
    mapsUrl: v.string(),
    reviews: v.string(), // trimmed allReviews
    likelyIcp: v.boolean(),
    isBuilding: v.optional(v.boolean()), // Maps listing is a single property (apartment complex…)
    building: v.optional(v.object({ verdict: v.string(), companyName: v.string(), companyWebsite: v.string() })),
    company: v.optional(v.string()), // management company behind a building listing (else = name)
    // enrichment
    domain: v.optional(v.string()),
    domainSource: v.optional(v.string()),
    siteOk: v.optional(v.boolean()),
    classify: v.optional(classifyV),
    owner: v.optional(ownerV),
    decision: v.optional(decisionV),
    email: v.optional(v.string()),
    emailSource: v.optional(v.string()),
    emailStatus: v.optional(v.string()), // valid | catch_all | risky | invalid
    tried: v.optional(v.array(v.string())),
    // Every find/verify step of the email waterfall, in order.
    emailTrail: v.optional(v.array(v.object({ finder: v.string(), email: v.string(), verifier: v.string(), status: v.string() }))),
    personal: v.optional(personalV),
    agentTrace: v.optional(v.array(v.object({ tool: v.string(), input: v.string(), ok: v.boolean() }))),
    vars: v.optional(v.record(v.string(), v.string())),
    // bookkeeping
    costUsd: v.number(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    leaseAt: v.optional(v.number()),
    pushedAt: v.optional(v.number()),
    pushedCampaign: v.optional(v.string()),
    note: v.optional(v.string()),
  })
    .index("by_run_state", ["runId", "state"])
    .index("by_state", ["state"])
    .index("by_placeId", ["placeId"])
    .index("by_domain", ["domain"]),

  // 5★ Google reviews WITH reviewer first names, imported once from reviews.csv (max 3 per place).
  reviews: defineTable({ placeId: v.string(), author: v.string(), rating: v.number(), text: v.string() }).index("by_place", ["placeId"]),
  meta: defineTable({ key: v.string(), value: v.any() }).index("by_key", ["key"]),

  // Large text kept off `leads` so grid queries stay cheap.
  leadBlobs: defineTable({ leadId: v.id("leads"), siteText: v.optional(v.string()), evidence: v.optional(v.string()) })
    .index("by_lead", ["leadId"]),

  stepLogs: defineTable({
    runId: v.id("runs"),
    leadId: v.id("leads"),
    stage: v.string(),
    ok: v.boolean(),
    ms: v.number(),
    costUsd: v.number(),
    calls: v.array(v.object({ provider: v.string(), costUsd: v.number(), credits: v.optional(v.number()) })),
    summary: v.string(),
    error: v.optional(v.string()),
  }).index("by_lead", ["leadId"]),
});
