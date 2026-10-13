# Gemini API (REST, generativelanguage.googleapis.com)
Researched: 2026-10-07 · Sources: https://ai.google.dev/gemini-api/docs/pricing , /docs/models , /docs/interactions , /docs/migrate-to-interactions , /docs/generate-content/{thinking,structured-output,url-context,google-search} , /api/generate-content , /docs/rate-limits , /docs/troubleshooting
(Doc pages were read through a summarizing fetcher; verify with one live call before relying on exact field names.)

## What we use it for
Cheap flash/flash-lite calls to extract/classify lead data as strict JSON, optionally grounded by Google Search / URL context; pro tier for harder synthesis. Called with plain `fetch` from Convex V8 actions.

**Big finding:** Google now calls `generateContent` "legacy" but "fully supported" and not deprecated. The **Interactions API** (`POST /v1beta/interactions`, GA June 2026) is the recommended one; "all new features launch there". Below documents generateContent (the plan) plus a short Interactions section.

## Endpoints & shapes (generateContent)
- `POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent`
- Headers: `x-goog-api-key: $KEY`, `Content-Type: application/json` (confirmed in official generateContent curl example on the thinking page).
- Body: `contents` (req), `systemInstruction` (text only), `tools`, `generationConfig` (`responseMimeType`, `responseSchema`, `responseJsonSchema`, `maxOutputTokens`, `temperature`, `topP`, `topK`, `stopSequences`, `candidateCount`, `thinkingConfig`), `safetySettings`, `cachedContent`.
```json
{
 "systemInstruction": {"parts":[{"text":"You extract company facts."}]},
 "contents": [{"role":"user","parts":[{"text":"Summarize acme.com"}]}],
 "tools": [{"google_search":{}}, {"url_context":{}}],
 "generationConfig": {
   "responseMimeType":"application/json",
   "responseJsonSchema": {"type":"object","properties":{"industry":{"type":"string"},"employees":{"type":"integer"}},"required":["industry"]},
   "maxOutputTokens": 2048,
   "thinkingConfig": {"thinkingLevel":"minimal"}
 }
}
```
Tool key spelling: docs show both `google_search`/`url_context` (snake) and `googleSearch`/`urlContext` (camel) in REST examples (see UNCONFIRMED).

### Structured output
- API reference lists both `responseSchema` ("JSON Schema for response", needs compatible `responseMimeType`) and `responseJsonSchema` ("JSON Schema in JSON format"). Neither is marked deprecated in the text I read.
- The newer structured-output guide shows a different shape: `generationConfig.responseFormat.text = {mimeType:"application/json", schema:{...}}` (Interactions API: `response_format:{type:"text",mime_type:"application/json",schema}`). The API reference text had no `responseFormat`. So: newest guides use responseFormat/response_format; the reference still has responseSchema/responseJsonSchema. Safest: test `responseJsonSchema` + `responseMimeType` in one live call; fall back to `responseSchema`.
- Supported subset: types string/number/integer/boolean/object/array/null; `properties`, `required`, `additionalProperties`; string `enum`, `format` (date-time, date, time); number `minimum`, `maximum`, `enum`; array `items`, `prefixItems`, `minItems`, `maxItems`; `title`, `description`. Unsupported keywords are ignored. Large/deeply nested schemas may be rejected. Syntactically valid JSON, but semantics not guaranteed: validate in code. (2.0 models need `propertyOrdering`.)

### Tools
- Google Search: `"tools":[{"google_search":{}}]`. Docs list Gemini 3.8 Flash, 3.5 Flash, 2.5 Pro/Flash, 2.0 Flash "among others". Old models used `google_search_retrieval`.
- URL context: `"tools":[{"url_context":{}}]`. Limits: 20 URLs/request, 34MB/URL, public URLs only. Supports HTML/JSON/text/XML, PNG/JPEG/WebP/BMP, PDF. Not supported: paywalled, YouTube, Google Workspace files, audio/video. Models: all current (3.x flash/flash-lite/pro-preview, 2.5 family).
- Tools + JSON schema in the same call: **Yes on Gemini 3 models** (official curl uses gemini-3.1-pro-preview with googleSearch + urlContext + structured output). 2.5 models: UNCONFIRMED.
- Response metadata on `candidates[0]`: `groundingMetadata{webSearchQueries[], groundingChunks[{web:{uri,title}}], groundingSupports[{segment:{startIndex,endIndex,text}, groundingChunkIndices[]}], searchEntryPoint}`; `urlContextMetadata{urlMetadata[{retrievedUrl, urlRetrievalStatus}]}`. Status enum: URL_RETRIEVAL_STATUS_SUCCESS / ERROR / PAYWALL / UNSAFE.

### Response
```json
{"candidates":[{"content":{"role":"model","parts":[{"text":"{...json...}"}]},"finishReason":"STOP",
  "groundingMetadata":{},"urlContextMetadata":{}}],
 "usageMetadata":{"promptTokenCount":0,"candidatesTokenCount":0,"thoughtsTokenCount":0,"toolUsePromptTokenCount":0,"cachedContentTokenCount":0,"totalTokenCount":0},
 "modelVersion":"..."}
```
Text = `candidates[0].content.parts[*].text` (skip parts with `thought:true`). finishReason values: STOP, MAX_TOKENS, SAFETY, RECITATION, LANGUAGE, BLOCKLIST, PROHIBITED_CONTENT, SPII, MALFORMED_FUNCTION_CALL (+ image ones). Blocked prompts surface in `promptFeedback` and may have no candidates.

### Thinking (`generationConfig.thinkingConfig`)
- Gemini 3.x use `thinkingLevel`. 3.8/3.7 Flash: low | medium (default) | high. 3.6/3.5 Flash: minimal | low | medium (default) | high. 3.5 and 3.1 Flash-Lite: minimal (default) | low | medium | high. 3.1 Pro: low | medium | high (default). **Thinking cannot be fully disabled on 3.x**; `minimal` is the floor where offered.
- 2.5 uses `thinkingBudget`: 0 disables on Flash variants, -1 dynamic, 2.5 Flash-Lite range 512-24576 (from search snippet). 2.5 Pro cannot disable. 2.5 does not support thinkingLevel.
- `includeThoughts:true` returns thought summaries. Thinking tokens bill as output and show in `thoughtsTokenCount`, separate from `candidatesTokenCount`. Set `maxOutputTokens` generously or JSON gets truncated.

### Interactions API (brief)
`POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`. Body: `model`, `input`, `system_instruction`, `tools:[{"type":"google_search"}]`, `response_format`, `generation_config{thinking_level,max_output_tokens,seed,stop_sequences}`, `service_tier` (flex|standard|priority|deferred), `store`. Response: `id`, `status`, `steps[]` (typed: model_output, google_search_result, ...), `usage{total_input_tokens,total_output_tokens,total_thought_tokens,total_cached_tokens}`. Field map: contents->input, generationConfig->generation_config, thinkingConfig->thinking_level, candidates->steps, usageMetadata->usage.

## Pricing (standard tier, re-checked 2026-10-13)

### Standard tier (per 1M tokens)
| Model ID | Input | Output | Cached Input |
|---|---|---|---|
| gemini-3.1-flash-lite | $0.25 (audio $0.50) | $1.50 | $0.025 |
| gemini-3.5-flash-lite | $0.30 | $2.50 | — |
| gemini-3.8 / 3.7 / 3.6-flash | $0.75 (through Dec 31) | $3.75 (through Dec 31) | $0.075 (through Dec 31) |
| gemini-3.5-flash | $1.50 | $9.00 | — |
| gemini-3.1-pro-preview | $2.00 (<=200k) | $12.00 | — |
| gemini-2.5-pro | $1.25 (<=200k) | $10.00 | — |

**Price change deadline:** ALL 3.8 Flash prices (input, output, cached) **double on Jan 1, 2027**: $1.50 in / $7.50 out / $0.15 cached.

Output price includes thinking tokens. Models page: only pro-tier 3.x is `gemini-3.1-pro-preview` (preview). 2.5 models are restricted to previously-active users (not deprecated).
- Google Search grounding, Gemini 3.x: 5,000 free search requests/month (shared), then $14 / 1,000, billed per search query the model executes. Gemini 2.5: 1,500 RPD free, then $35 / 1,000 grounded prompts.
- URL context: no separate fee, retrieved content billed as input tokens.
- **Flex tier (beta):** 50% off all prices; `service_tier: "flex"` as a top-level field on generateContent requests. Latency target 1–15 min; returns 429 (RESOURCE_EXHAUSTED) or 503 (overloaded) when no capacity, no auto-upgrade to standard tier.
- **Batch API:** 50% off all prices; submit requests for async execution. Suitable for non-time-sensitive tasks.
- Suggested: cheap = `gemini-3.1-flash-lite` (or `gemini-3.5-flash-lite`); mid = `gemini-3.8-flash`; pro = `gemini-3.1-pro-preview`.

### Prompt caching
- **Implicit:** on by default, no opt-in required.
- **Minimum:** 4,096 tokens per cache on 3.8 / 3.6 Flash (exact minimum per model varies).
- **Token tracking:** `usageMetadata.cachedContentTokenCount` on generateContent responses. LangChain SDK: `usage_metadata.input_token_details.cache_read`.

## Limits & gotchas
- Limits are RPM, TPM, RPD per project, by tier: Free; Tier 1 (billing on); Tier 2 ($100+ spent, 3+ days); Tier 3 ($1,000+, 30+ days). Paid tiers also have rolling 10-minute spend caps ($10/$50/$200 for T1/T2/T3) that trigger 429. Per-model numbers are only in AI Studio (aistudio.google.com/rate-limit).
- 429 `RESOURCE_EXHAUSTED`, 503 overloaded: retry with exponential backoff + jitter (official SDKs retry up to 4x). Do not retry 400/403/404.
- Always check `finishReason` before `JSON.parse` (MAX_TOKENS truncation, thinking eats budget).
- Keep the key in a Convex env var; leaked keys are blocked by Google.

## UNCONFIRMED
- Whether `responseJsonSchema`, `responseSchema`, or `responseFormat.text.schema` is preferred on generateContent (all appear on official pages).
- Canonical casing of tool keys (`google_search` vs `googleSearch`) in generateContent REST.
- Tools + JSON schema on 2.5 models; google_search support listing for 3.5/3.1 flash-lite specifically.
- Per-model RPM/TPM/RPD numbers; whether 429 sends Retry-After.
- Migration page curl uses `/v1beta2/interactions`; other pages use `/v1beta/interactions`.
- Exact Interactions model_output step JSON layout.

## Live-verified 2026-10-07 (Convex action, real key)
- `generationConfig.responseMimeType` + `responseJsonSchema` works on gemini-3.1-flash-lite and gemini-3.8-flash (incl. string `enum`). Fast call ≈ $0.0003.
- `thinkingConfig.thinkingLevel: "low"` accepted by both models.
- `tools: [{url_context:{}}]` and `[{urlContext:{}}]` both work. Blocked sites → `urlContextMetadata.urlMetadata[].urlRetrievalStatus = URL_RETRIEVAL_STATUS_ERROR` and the model replies with an "I am unable to access…" sentence (we filter it).
