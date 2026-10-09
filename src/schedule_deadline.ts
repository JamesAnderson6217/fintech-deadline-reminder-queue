import { infrai, stableKey } from "./infrai.ts";

const task = process.env.DEADLINE_WEBHOOK_URL;
if (!task) throw new Error("Set DEADLINE_WEBHOOK_URL to the public /deadlines/remind URL.");

const schedule = { cron_expr: "0 9 * * *", task };
const result = await infrai.cron.create(schedule, stableKey("daily-deadline-scan", schedule));
console.log(JSON.stringify({ scheduled: true, jobId: result.job_id }, null, 2));
