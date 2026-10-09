import { z } from "zod";

export const paymentDeadlineSchema = z.object({
  paymentId: z.string().min(1),
  accountId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  dueAt: z.string().datetime({ offset: true }),
  daysUntilDue: z.number().int().min(0),
  riskScore: z.number().min(0).max(100),
});

export type PaymentDeadline = z.infer<typeof paymentDeadlineSchema>;

export type ReminderDecision = {
  paymentId: string;
  accountId: string;
  action: "notify" | "notify_and_review";
  priority: "normal" | "urgent";
  audit: {
    reason: string;
    evaluatedAt: string;
    dueAt: string;
    amountMinor: number;
    currency: string;
    riskScore: number;
  };
};

export function decideReminder(
  deadline: PaymentDeadline,
  evaluatedAt: string,
): ReminderDecision {
  const needsReview = deadline.riskScore >= 70 || deadline.amountMinor >= 1_000_000;
  return {
    paymentId: deadline.paymentId,
    accountId: deadline.accountId,
    action: needsReview ? "notify_and_review" : "notify",
    priority: deadline.daysUntilDue <= 1 ? "urgent" : "normal",
    audit: {
      reason: needsReview ? "risk threshold met" : "deadline approaching",
      evaluatedAt,
      dueAt: deadline.dueAt,
      amountMinor: deadline.amountMinor,
      currency: deadline.currency,
      riskScore: deadline.riskScore,
    },
  };
}
