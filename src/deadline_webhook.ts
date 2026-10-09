import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, infrai, stableKey } from "./infrai.ts";
import { decideReminder, paymentDeadlineSchema } from "./reminder_policy.ts";

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function callerStatus(error: InfraiError): number {
  return error.status >= 400 && error.status < 500 ? error.status : 502;
}

function configuredDeadline(): unknown {
  const value = process.env.PAYMENT_DEADLINE_JSON;
  if (!value) throw new SyntaxError("Set PAYMENT_DEADLINE_JSON for scheduled calls.");
  return JSON.parse(value);
}

export const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/deadlines/remind") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8").trim();
    const deadline = paymentDeadlineSchema.parse(
      rawBody.length > 0 ? JSON.parse(rawBody) : configuredDeadline(),
    );
    const reminder = decideReminder(deadline, new Date().toISOString());
    await infrai.queue.publish(
      reminder,
      stableKey("payment-reminder", { paymentId: deadline.paymentId, dueAt: deadline.dueAt }),
    );
    reply(response, 202, { accepted: true, reminder });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      reply(response, 400, { error: "Invalid payment deadline", details: error.message });
      return;
    }
    if (error instanceof InfraiError) {
      reply(response, callerStatus(error), { error: error.code, message: error.message });
      return;
    }
    reply(response, 500, { error: "Request could not be processed" });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Deadline webhook listening on http://localhost:${port}`));
}
