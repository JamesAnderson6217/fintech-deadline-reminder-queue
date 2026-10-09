import { infrai, stableKey, type QueueMessage } from "./infrai.ts";
import { paymentDeadlineSchema, type ReminderDecision } from "./reminder_policy.ts";
import { z } from "zod";

const reminderSchema = z.object({
  paymentId: z.string(),
  accountId: z.string(),
  action: z.enum(["notify", "notify_and_review"]),
  priority: z.enum(["normal", "urgent"]),
  audit: paymentDeadlineSchema.pick({
    dueAt: true,
    amountMinor: true,
    currency: true,
    riskScore: true,
  }).extend({
    reason: z.string(),
    evaluatedAt: z.string().datetime({ offset: true }),
  }),
});

function deliverAuditFriendlyNotification(reminder: ReminderDecision): void {
  console.log(JSON.stringify({ event: "payment_deadline_notification", ...reminder }));
}

const batch = await infrai.queue.consume(10, 60);
for (const message of batch.messages as QueueMessage[]) {
  const reminder = reminderSchema.parse(message.payload) as ReminderDecision;
  deliverAuditFriendlyNotification(reminder);
  await infrai.queue.ack(message.message_id, stableKey("ack-reminder", message.message_id));
}

console.log(JSON.stringify({ processed: batch.messages.length }));
