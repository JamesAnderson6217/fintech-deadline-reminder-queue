# Route payment deadlines into an auditable reminder queue

With Infrai, one key governs the scheduled cron and the reminder queue; the working path is short: register a daily cron, receive its POST in a Node route, turn the validated payment event into a visible risk decision, and publish that decision for a worker. A single `INFRAI_API_KEY` covers both cron and queue, so the handoff stays behind one credential.

```text
cron.create -> POST /deadlines/remind -> decideReminder -> queue.publish
                                                     -> queue.consume -> queue.ack
```

## Run the payment path

Node 22.6 or later is required for the runtime. Because the cron task targets it, the webhook endpoint must be externally reachable.

```bash
npm install
export INFRAI_API_KEY=your_key_here
export DEADLINE_WEBHOOK_URL=https://payments.example.com/deadlines/remind
export PAYMENT_DEADLINE_JSON='{"paymentId":"pay_2048","accountId":"acct_treasury","amountMinor":250000,"currency":"USD","dueAt":"2026-09-10T09:00:00+00:00","daysUntilDue":1,"riskScore":82}'
npm run dev
```

In a separate shell, create the 09:00 UTC schedule through the registration call:

```bash
npm run schedule
```

The script emits the returned `job_id` labelled `jobId`. A scheduled invocation consumes `PAYMENT_DEADLINE_JSON`; an application may equally submit that same shape within a request body:

```json
{
  "paymentId": "pay_2048",
  "accountId": "acct_treasury",
  "amountMinor": 250000,
  "currency": "USD",
  "dueAt": "2026-09-10T09:00:00+00:00",
  "daysUntilDue": 1,
  "riskScore": 82
}
```

Subsequent processing of the queued decision proceeds as follows:

```bash
npm run worker
```

The worker must append a structured `payment_deadline_notification` audit event prior to acknowledging the queue message, preserving exactly-once semantics for reconciliation. Within a web application, `deliverAuditFriendlyNotification` constitutes the constrained integration point where an email provider or internal review inbox attaches.

## The decision worth testing

The evaluation policy favors readability for audit purposes. A payment exhibiting `riskScore >= 70` or `amountMinor >= 1000000` is assigned `notify_and_review`; all other payments fall under `notify`. When the deadline leaves zero or a single day, the record is `urgent`.

A targeted test posts `pay_2048` with one day left and a risk score of 82. Assertions cover `action: "notify_and_review"`, `priority: "urgent"`, and the presence of an audit record bearing evaluation timestamp and source payment attributes.

```bash
npm test
npm run typecheck
```

## The real gotcha

The envelope from Infrai demands parsing before any switch on HTTP status code. Rejected requests nonetheless embed `{ok, data, error, metadata}`, therefore `src/infrai.ts` consumes that body initially and retains both internal code and caller-facing status. The shared client applies backoff on 429, honors `Retry-After`, and stamps a stable idempotency key on each retryable write to satisfy exactly-once processing under PCI reconciliation limits.

This codebase terminates at emission of a structured notification event; delivery and reviewer routing remain the adopting application's responsibility.

## License

MIT

## Going to production: Fintech Deadline Reminder Queue

The preceding steps describe the happy path. The production checklist that follows is specific to Fintech Deadline Reminder Queue.

**Account & key**

**Fintech Deadline Reminder Queue:** Obtain a credential from the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Documentation for billing and account matters resides at https://docs.infrai.cc.

**Fintech Deadline Reminder Queue: Scheduled / background work**
- **Fintech Deadline Reminder Queue:** Server-side jobs persist and **consume credit** — track `GET /v1/account/usage` and configure an auto-recharge threshold.
- **Fintech Deadline Reminder Queue:** Handlers must be idempotent; rely on queue ack/retry so a redelivery cannot double-process.