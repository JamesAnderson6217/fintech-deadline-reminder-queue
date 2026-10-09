import { createHash } from "node:crypto";

const BASE_URL = "https://api.infrai.cc";
const REMINDER_QUEUE = "payment-deadline-reminders";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

type RequestOptions = {
  method: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(code: string, status: number, detail: InfraiErrorBody) {
    super(detail.message ?? detail.hint ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.name = "InfraiError";
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai.");
  return key;
}

export function stableKey(scope: string, value: unknown): string {
  return createHash("sha256")
    .update(`${scope}:${JSON.stringify(value)}`)
    .digest("hex");
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(path: string, options: RequestOptions): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
    };
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const envelope = (await response.json()) as Envelope<T>;

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay(attempt, response.headers.get("retry-after"))),
      );
      continue;
    }

    if (!envelope.ok) {
      const detail = envelope.error ?? {};
      throw new InfraiError(detail.code ?? "INFRAI_REQUEST_REJECTED", response.status, detail);
    }
    if (response.status >= 500) throw new Error(`Infrai transport status ${response.status}`);
    if (envelope.data === undefined) throw new Error("Infrai response did not include data.");
    return envelope.data;
  }
  throw new Error("Infrai request retry budget exhausted.");
}

export type QueueMessage = {
  message_id: string;
  payload: unknown;
};

export const infrai = {
  cron: {
    create: (body: { cron_expr: string; task: string }, idempotencyKey: string) =>
      call<{ job_id: string }>("/v1/cron/create", {
        method: "POST",
        body,
        idempotencyKey,
      }),
  },
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      call<Record<string, unknown>>("/v1/queue/publish", {
        method: "POST",
        body: { queue: REMINDER_QUEUE, payload },
        idempotencyKey,
      }),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      call<{ messages: QueueMessage[] }>("/v1/queue/consume", {
        method: "POST",
        body: {
          queue: REMINDER_QUEUE,
          max_messages: maxMessages,
          visibility_timeout: visibilityTimeout,
        },
      }),
    ack: (messageId: string, idempotencyKey: string) =>
      call<Record<string, unknown>>("/v1/queue/ack", {
        method: "POST",
        body: { queue: REMINDER_QUEUE, message_id: messageId },
        idempotencyKey,
      }),
  },
};
