# LangGraph.js (+ Gemini)
Researched: 2026-10-07 · Versions (npm, 2026-10-07): @langchain/langgraph 1.4.21, langchain 1.5.15, @langchain/core 1.2.17, @langchain/google 0.2.9 (recommended Gemini pkg), @langchain/google-genai 2.3.2 (legacy), zod 4.6.5 · Sources: npm registry (`npm view`; tarballs inspected via `npm pack`, nothing installed), docs.langchain.com/oss/javascript/{langchain/agents, langchain/structured-output, langchain/middleware/built-in, integrations/chat/google, integrations/chat/google_generative_ai, langgraph/errors/GRAPH_RECURSION_LIMIT, migrate/langgraph-v1}, docs.convex.dev/functions/bundling

## What we use it for
One tool-calling research agent (Gemini model, custom tools, final structured JSON) run inside a Convex `"use node"` action. Loop = model -> tools -> model until done or step cap.

Install list:
```
npm i @langchain/langgraph@1.4.21 @langchain/core@1.2.17 @langchain/google@0.2.9 langchain@1.5.15 zod@4.6.5
```
- `langchain` already depends on `@langchain/langgraph` (^1.4.13); keep langgraph as a direct dep only because we import `GraphRecursionError` from it (dedupes).
- Peers: langgraph -> `@langchain/core ^1.1.48`, `zod ^3.25.32 || ^4.2.0`; langchain -> `@langchain/core ^1.2.14` (zod regular dep `^3.25.76 || ^4`); @langchain/google -> `@langchain/core ^1.2.14`; google-genai -> `@langchain/core ^1.2.11`. All satisfied by the set above. Need exactly ONE copy of @langchain/core. All require Node >=20.
- Gemini package: **`@langchain/google` (class `ChatGoogle`) is the recommended one.** Its README: "will be replacing ChatGoogleGenerativeAI and ChatVertex"; the docs page for `@langchain/google-genai` says it is built on a deprecated Google SDK (`@google/generative-ai`) and will be replaced by ChatGoogle. npm `deprecated` field is empty for both (docs notice only, no hard deprecation). @langchain/google uses direct REST (no Google SDK) so it is lighter.

## Key APIs (minimal examples)
**Recommended agent API: `createAgent` from `"langchain"` (v1).** `createReactAgent` from `"@langchain/langgraph/prebuilt"` is DEPRECATED (migration guide: replaced by createAgent; 1.4.21 typings mark `CreateReactAgentParams`/`AgentState` "moved to langchain"). Still exported but do not use. Renames: `prompt` -> `systemPrompt`; pre-model hooks / dynamic prompts -> middleware.

```ts
"use node";
import { createAgent, tool } from "langchain";   // tool also at "@langchain/core/tools"
import { ChatGoogle } from "@langchain/google";
import * as z from "zod";

const webSearch = tool(async ({ query }) => `results for ${query}`, {
  name: "web_search",
  description: "Search the web",
  schema: z.object({ query: z.string() }),
});
const fetchPage = tool(async ({ url }) => `content of ${url}`, {
  name: "fetch_page",
  description: "Fetch a page as text",
  schema: z.object({ url: z.string() }),
});

const model = new ChatGoogle({
  model: "gemini-3.8-flash",
  apiKey: process.env.GEMINI_API_KEY, // falls back to GOOGLE_API_KEY env if omitted
  temperature: 0.2,
  maxOutputTokens: 4096,
  maxRetries: 2,
});
const agent = createAgent({ model, tools: [webSearch, fetchPage], systemPrompt: "You are a research agent." });
const result = await agent.invoke(
  { messages: [{ role: "user", content: "Research Acme Inc." }] },
  { recursionLimit: 25 },
);
```
Pass a model instance (not a "provider:model" string) to control apiKey. Do not pre-bind tools to the model (`bindTools`) when using structured output.

ChatGoogle options (0.2.9 typings + docs): `model`, `apiKey`, `temperature`, `maxOutputTokens`, `maxRetries` (inherited LangChain base-model option; not in ChatGoogle .d.ts, UNCONFIRMED live), `safetySettings`, `platformType` ("gcp" for Vertex express), thinking: `reasoningEffort`/`thinkingLevel` ("minimal"|"low"|"medium"|"high", Gemini 3) and `maxReasoningTokens`/`thinkingBudget` (number, Gemini 2.5). Thought signatures (needed by Gemini 3 across tool turns) are supported in @langchain/google.

## Structured output
`createAgent({ ..., responseFormat })`; result in `result.structuredResponse` (produced in the main loop in v1, no extra node). Accepts zod / Standard Schema / JSON Schema, or explicit `providerStrategy(schema)` (native; Gemini supported) / `toolStrategy(schema)` (fallback via extra tool call, retries on validation errors, `handleError`). Tools + structured output together requires model support (Gemini 3: yes per kb/gemini-genai.md; 2.5 UNCONFIRMED).
```ts
import { providerStrategy } from "langchain";
const Out = z.object({ summary: z.string(), confidence: z.number() });
const agent = createAgent({ model, tools, responseFormat: providerStrategy(Out) }); // or responseFormat: Out
const r = await agent.invoke({ messages: [...] }, { recursionLimit: 25 });
r.structuredResponse; // { summary, confidence }
```
Alternative (most robust): run the agent for research, then one cheap `model.withStructuredOutput(Out).invoke(transcript)` call.

## Step cap & errors
- `recursionLimit` in invoke config; **default 25** (verified in langgraph 1.4.21 source: `DEFAULT_RECURSION_LIMIT = 25`). Counts graph supersteps (model call + tool node ~ 2 steps per round, so ~12 tool rounds at 25). Parallel tool calls in one AIMessage run in one step.
- Exceeded -> throws `GraphRecursionError` (`import { GraphRecursionError } from "@langchain/langgraph"`, code `GRAPH_RECURSION_LIMIT`; also check `e.name`).
```ts
try { await agent.invoke(input, { recursionLimit: 25 }); }
catch (e) {
  if (e instanceof GraphRecursionError || (e as any)?.name === "GraphRecursionError") { /* fallback */ }
  else throw e;
}
```
  Partial messages are lost on throw unless streaming (`agent.stream(input, { streamMode: "values" })`, keep last chunk) or a checkpointer.
- Middleware (import from `"langchain"`): `toolCallLimitMiddleware({ runLimit, threadLimit, toolName?, exitBehavior: "continue"(default)|"error"|"end" })` ("error" throws `ToolCallLimitExceededError`); `modelCallLimitMiddleware({ runLimit, threadLimit, exitBehavior: "end"(default)|"error" })`. Use `middleware: [toolCallLimitMiddleware({ runLimit: 10 }), modelCallLimitMiddleware({ runLimit: 12 })]` for graceful caps; keep recursionLimit as hard backstop. `threadLimit` implies a checkpointer; `runLimit` does not.

## Token usage / cost
Each AIMessage in `result.messages` has `usage_metadata: { input_tokens, output_tokens, total_tokens, input_token_details?, output_token_details? }` (docs example `{input_tokens:6, output_tokens:7, total_tokens:13}`). Sum over all messages and price with the table in kb/gemini-genai.md. Thinking tokens: billed as output; whether they are in `output_tokens` or in `output_token_details.reasoning` is UNCONFIRMED. A separate `withStructuredOutput` call has its own usage to add.
```ts
let inT = 0, outT = 0;
for (const m of result.messages) { const u = (m as any).usage_metadata; if (u) { inT += u.input_tokens; outT += u.output_tokens; } }
```

## Running inside Convex
- Use a `"use node"` file (actions only, no queries/mutations there). Node action: 10 min, args 5 MiB (kb/convex.md). LangGraph needs `node:async_hooks` (AsyncLocalStorage), so it must NOT run in the default V8 runtime.
- Packages are dual ESM/CJS (`exports` has `import` and `require`), Node >=20. Only `node:async_hooks`, `node:fs/promises`, `node:path` imported (grep of langgraph, langchain, @langchain/google dist) - all available in Convex Node runtime. No known esbuild issues found.
- **convex.json externalPackages: NOT required in principle** (UNCONFIRMED by an actual deploy). Convex docs: it exists for large non-tree-shakeable libs that exceed the 32 MB bundle limit (aws-sdk, sharp). Unpacked sizes: core 7.6 MB, langgraph 4.4 MB, langchain 3.2 MB, google 1.1 MB, zod 6 MB; tree-shaken bundle is likely far below 32 MB. Try plain bundling first. Fallback if bundle-size or interop errors appear (file `convex.json` beside package.json; none exists in the project yet):
```json
{
  "$schema": "./node_modules/convex/schemas/convex.schema.json",
  "node": { "externalPackages": ["@langchain/core", "@langchain/langgraph", "@langchain/google", "langchain"] }
}
```
  External packages are resolved from local node_modules at deploy (limit 45 MB zipped / 240 MB unzipped), so keep exactly one @langchain/core version. For CJS interop errors Convex docs suggest default-import then destructure.
- 512 MB memory is fine; truncate tool outputs (page text) to limit context.
- Store key as Convex env var (`GEMINI_API_KEY`) and pass `apiKey` explicitly.

## Limits & gotchas
- Default recursionLimit 25; set explicitly. Each loop iteration re-sends the whole transcript, so input tokens grow roughly quadratically; truncate tool outputs.
- Gemini tool-schema restrictions: keep zod tool schemas flat and simple (complex/union/MCP-derived schemas cause Gemini schema errors); prefer `.optional()` over odd nullable/union forms. Gemini "specialty" tools (Google Search grounding, code execution, URL context) cannot be mixed with normal function tools in the same call.
- Gemini 3 thought signatures must be preserved across tool turns; @langchain/google does this - do not rebuild/strip AIMessages manually between steps.
- Legacy google-genai restrictions: system message merged into first human message, alternating human/AI required; another reason to use @langchain/google.
- langgraph 1.4.21 and core 1.2.17 were published 2026-10-06/07 (hours old): pin exact versions, commit lockfile, step back one patch if a regression shows.
- v1 `langchain` is not the old monolith: ignore old tutorials (`AgentExecutor`, prebuilt `createReactAgent`, `@langchain/community`).
- LangSmith tracing is off unless `LANGSMITH_TRACING=true`; leave it unset (langsmith is a dependency).

## Supply-chain check (read-only, 2026-10-07)
| pkg | version | maintainers | modified | install scripts | direct deps |
|---|---|---|---|---|---|
| @langchain/langgraph | 1.4.21 | lc-oss-admin, langchain-security (langchain.dev) | 2026-10-07 | none | 4 (@langchain/protocol, @standard-schema/spec, langgraph-sdk, langgraph-checkpoint) |
| @langchain/core | 1.2.17 | same | 2026-10-06 | none | 7 (zod, p-queue, mustache, langsmith, js-tiktoken, @cfworker/json-schema, @standard-schema/spec) |
| @langchain/google | 0.2.9 | same | 2026-10-01 | none | 3 (jose, eventsource-parser, google-auth-library) |
| @langchain/google-genai | 2.3.2 | same | 2026-09-12 | none | 1 (@google/generative-ai) |
| langchain | 1.5.15 | hntrl + lc-oss-admin | 2026-10-01 | none | 4 (zod, langsmith, langgraph, langgraph-checkpoint) |
| zod | 4.6.5 | colinhacks | 2026-10-02 | none | 0 |

Resolved trees via `npm install --package-lock-only --ignore-scripts` in the scratchpad: langgraph+core+zod = 22 packages; + @langchain/google = 47; google-genai set = 49; all five = 50 packages. None flagged `hasInstallScript`. Only a node-import grep of the tarballs was done, not a full source audit (UNCONFIRMED).

## UNCONFIRMED
- Real Convex deploy/bundle of these packages in a Node action; whether externalPackages is ever needed.
- `maxRetries` on ChatGoogle (inherited, absent from its typings).
- Field holding Gemini thinking tokens (`output_token_details.reasoning`?).
- Gemini 2.5 tools + structured output together; providerStrategy behaviour with gemini-3.8-flash specifically.
- Model id `gemini-3.8-flash` accepted by ChatGoogle (docs example uses gemini-3.7-flash; kb/gemini-genai.md lists 3.8-flash as a valid REST id).
- Partial transcript recovery after GraphRecursionError without checkpointer (assume none).
