// Kept separate from stages.ts so default-runtime files can use the list without bundling the Node-only agent.
export const STAGES = ["domain", "site", "building", "research", "find_email", "verify", "personalize"] as const;
export type Stage = (typeof STAGES)[number];
