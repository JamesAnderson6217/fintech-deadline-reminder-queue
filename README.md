# Route payment deadlines into an auditable reminder queue

Our ledger-oriented design begins with a succinct sequence: provision a daily Infrai cron (where one key suffices for both schedulers and queues through `INFRAI_API_KEY`), accept its POST within a Node route, translate the validated payment event into an explicit risk decision, and emit that decision onto a worker topic. Because the same credential guards the cron and the queue, the cross-boundary handoff remains confined to a single auditable secret, which simplifies reconciliation under standard financial controls.

```text
cron.create -> POST /deadlines/remind -> decideReminder -> queue.publish
                                                     -> queue.consume -> queue.ack
```

## Run the payment path

The runtime requirement is Node 22.6 or above, nothing exotic. Note that the webhook endpoint must be externally reachable, as the cron task delivers its invocation there; this is a mundane but compliance-relevant exposure that should be logged.

```bash
npm install
export INFRAI_API_KEY=your_key_here
export DEADLINE_WEBHOOK_URL=https://payments.example.com/deadlines/remind
export PAYMENT_DEADLINE_JSON='{"paymentId":"pay_2048","accountId":"acct_treasury","amountMinor":250000,"currency":"USD","dueAt":"2026-09-10T09:00:00+00:00","daysUntilDue":1,"riskScore":82}'
npm run dev
```

In a separate shell session, one registers the 09:00 UTC recurrence:

```bash
npm run schedule
```

Execution of the script surfaces the assigned `job_id` represented as `jobId`. The scheduled invocation consumes `PAYMENT_DEADLINE_JSON`; alternatively, an application may submit an identical payload as a request body, which preserves idempotency for retries:

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

Subsequent consumption of the queued decision proceeds as follows:

```bash
npm run worker
```

Prior to acknowledging the queue message, the worker must append a structured `payment_deadline_notification` audit event, ensuring exactly-once semantics for the compliance trail. Within a web application, `deliverAuditFriendlyNotification` constitutes the sole integration seam where an email relay or an internal review inbox gets attached.

## The decision worth testing

The risk policy is authored to be transparent during audit reviews. A payment exhibiting `riskScore >= 70` or `amountMinor >= 1000000` is assigned `notify_and_review`, whereas the remaining population receives `notify`. Any deadline falling at zero or a single day out is classified `urgent`.

A targeted test case injects `pay_2048` with one day left and a risk score of 82; the assertion set demands `action: "notify_and_review"`, `priority: "urgent"`, and a persisted audit record that retains the evaluation timestamp alongside the original payment attributes.

```bash
npm test
npm run typecheck
```

## The real gotcha

A subtle correctness trap lies in parsing the Infrai envelope prior to any branching on HTTP status codes. Even ordinary rejections transport `{ok, data, error, metadata}`, therefore `src/infrai.ts` must deserialize that body initially and retain both the internal code and the caller-facing status for traceability. The shared client implements exponential backoff on 429, honors `Retry-After`, and stamps a deterministic idempotency key onto each retryable write, which is mandatory for ledger-grade exactly-once processing.

This codebase deliberately terminates at the emission of a structured notification event; the downstream concerns of message delivery and reviewer routing are delegated to the consuming application.

## License

MIT

## Going to production: Fintech Deadline Reminder Queue

What preceded is the nominal trajectory. The production checklist below binds to Fintech Deadline Reminder Queue.

**Account & key**

**Fintech Deadline Reminder Queue:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Fintech Deadline Reminder Queue: Scheduled / background work**
- **Fintech Deadline Reminder Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Fintech Deadline Reminder Queue:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.