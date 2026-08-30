import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "clean abandoned knowledge uploads",
  { hours: 24 },
  internal.knowledgeOrphans.sweep,
  { cursor: null },
);

export default crons;
