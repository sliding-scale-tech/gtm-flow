import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("sweep stuck leads and runs", { minutes: 2 }, internal.pipeline.sweep, {});
export default crons;
