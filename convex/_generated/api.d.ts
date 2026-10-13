/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as auth from "../auth.js";
import type * as costs from "../costs.js";
import type * as crons from "../crons.js";
import type * as defaults from "../defaults.js";
import type * as evals from "../evals.js";
import type * as evalsNode from "../evalsNode.js";
import type * as ingest from "../ingest.js";
import type * as leads from "../leads.js";
import type * as lib_costModel from "../lib/costModel.js";
import type * as lib_csv from "../lib/csv.js";
import type * as lib_precheck from "../lib/precheck.js";
import type * as lib_quota from "../lib/quota.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_stageList from "../lib/stageList.js";
import type * as lib_text from "../lib/text.js";
import type * as pipeline from "../pipeline.js";
import type * as providers_email from "../providers/email.js";
import type * as providers_exa from "../providers/exa.js";
import type * as providers_gemini from "../providers/gemini.js";
import type * as providers_google from "../providers/google.js";
import type * as providers_http from "../providers/http.js";
import type * as reviews from "../reviews.js";
import type * as runs from "../runs.js";
import type * as settings from "../settings.js";
import type * as stageKit from "../stageKit.js";
import type * as stages from "../stages.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  auth: typeof auth;
  costs: typeof costs;
  crons: typeof crons;
  defaults: typeof defaults;
  evals: typeof evals;
  evalsNode: typeof evalsNode;
  ingest: typeof ingest;
  leads: typeof leads;
  "lib/costModel": typeof lib_costModel;
  "lib/csv": typeof lib_csv;
  "lib/precheck": typeof lib_precheck;
  "lib/quota": typeof lib_quota;
  "lib/rules": typeof lib_rules;
  "lib/stageList": typeof lib_stageList;
  "lib/text": typeof lib_text;
  pipeline: typeof pipeline;
  "providers/email": typeof providers_email;
  "providers/exa": typeof providers_exa;
  "providers/gemini": typeof providers_gemini;
  "providers/google": typeof providers_google;
  "providers/http": typeof providers_http;
  reviews: typeof reviews;
  runs: typeof runs;
  settings: typeof settings;
  stageKit: typeof stageKit;
  stages: typeof stages;
  worker: typeof worker;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
