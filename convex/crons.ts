import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("close abandoned calls", { minutes: 15 }, internal.conversations.reapStale, {});

export default crons;
