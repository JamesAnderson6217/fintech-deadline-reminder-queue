import assert from "node:assert/strict";
import test from "node:test";
import { decideReminder, paymentDeadlineSchema } from "../src/reminder_policy.ts";

test("an urgent high-risk payment is notified and sent for review", () => {
  const deadline = paymentDeadlineSchema.parse({
    paymentId: "pay_2048",
    accountId: "acct_treasury",
    amountMinor: 250_000,
    currency: "USD",
    dueAt: "2026-09-10T09:00:00+00:00",
    daysUntilDue: 1,
    riskScore: 82,
  });

  const decision = decideReminder(deadline, "2026-09-09T09:00:00.000Z");

  assert.equal(decision.action, "notify_and_review");
  assert.equal(decision.priority, "urgent");
  assert.deepEqual(decision.audit, {
    reason: "risk threshold met",
    evaluatedAt: "2026-09-09T09:00:00.000Z",
    dueAt: "2026-09-10T09:00:00+00:00",
    amountMinor: 250_000,
    currency: "USD",
    riskScore: 82,
  });
});
