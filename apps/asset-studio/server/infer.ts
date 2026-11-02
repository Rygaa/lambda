import { inferConfig } from "./config.ts";
import { StudioError } from "./errors.ts";

export type InferChoice = { model: string; reasoningEffort: string };

// Cloudflare in front of Infer sends these codes, with no JSON message, when it cannot reach Infer.
const GATEWAY_ERRORS = [502, 503, 504, 520, 521, 522, 523, 524];
const ATTEMPTS = 2;

// Infer runs 2 image calls at the same time. More calls wait here, not in its queue behind Cloudflare.
const MAX_PARALLEL_IMAGES = 2;
let runningImages = 0;
const waitingImages: (() => void)[] = [];

async function takeImageSlot() {
  if (runningImages < MAX_PARALLEL_IMAGES) {
    runningImages++;
    return;
  }
  // releaseImageSlot hands the slot over, so the count does not change here.
  await new Promise<void>((resolve) => waitingImages.push(resolve));
}

function releaseImageSlot() {
  const next = waitingImages.shift();
  if (next) return next();
  runningImages--;
}

type InferBody = {
  code?: string;
  message?: string;
  result?: Record<string, unknown>;
  data?: { issues?: { path?: (string | number)[]; message: string }[] };
};

// The last event of a stream: the request view.
type DoneView = { status?: string; result?: Record<string, unknown>; error?: { code?: string; message?: string } };

function inferError(status: number, answer: InferBody) {
  const code = answer.code ? `${answer.code}: ` : "";
  const issues = (answer.data?.issues ?? [])
    .map((issue) => `${(issue.path ?? []).join(".") || "body"}: ${issue.message}`)
    .join("; ");
  return new StudioError(502, `Infer error ${status}: ${code}${answer.message}${issues ? ` (${issues})` : ""}`);
}

// Reads the SSE stream until the "done" event and returns its data.
// The first message carries the request id, given to onAccepted.
async function readDone(response: Response, onAccepted: (requestId: string) => void) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return null;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (event === "done" || event === "error") {
        reader.cancel().catch(() => {});
        return { event, data: JSON.parse(data || "{}") as DoneView & InferBody };
      }
      const message = JSON.parse(data || "{}") as { event?: string; requestId?: string };
      if (message.event === "accepted" && message.requestId) onAccepted(message.requestId);
    }
  }
}

function finish(view: DoneView) {
  if (view.status === "succeeded" && view.result) return view.result;
  throw new StudioError(502, `Infer error: ${view.error?.code ?? "REQUEST_FAILED"}: ${view.error?.message ?? "no result returned."}`);
}

// Reads a request every 10 seconds until it ends.
async function waitForRequest(requestId: string, timeoutMs: number) {
  const config = inferConfig();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const response = await fetch(`${config.url}/v1/requests/${requestId}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    // A gateway error or a dropped connection is tried again at the next turn.
    if (!response?.ok) continue;
    const view = (await response.json().catch(() => ({}))) as DoneView;
    if (view.status && view.status !== "running") return view;
  }
  throw new StudioError(502, `Infer request ${requestId} did not end in time.`);
}

// Sends one request in mode "stream" and returns its result. Infer sends keep-alive
// pings on a stream, so a long call does not hit the 100 s limit of Cloudflare.
async function request(body: object, timeoutMs: number) {
  const config = inferConfig();
  const payload = JSON.stringify({ ...body, mode: "stream" });
  let status = 0;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const response = await fetch(`${config.url}/v1/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
      let requestId: string | null = null;
      const done = await readDone(response, (id) => (requestId = id)).catch((error: unknown) => {
        // The request keeps running on Infer when the connection drops, so its result can still be read.
        if (!requestId) throw error;
        console.log(`Infer stream of ${requestId} was cut. Waiting for the request.`);
        return null;
      });
      if (!done && requestId) return finish(await waitForRequest(requestId, timeoutMs));
      if (!done) throw new StudioError(502, "Infer error: the stream ended with no result.");
      if (done.event === "error") throw inferError(500, done.data);
      return finish(done.data);
    }

    // A JSON message comes from Infer itself. Trying again will not fix it.
    // A validation error lists the wrong fields in data.issues.
    const answer = (await response.json().catch(() => ({}))) as InferBody;
    if (answer.message) throw inferError(response.status, answer);
    status = response.status;
    if (!GATEWAY_ERRORS.includes(status)) break;
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const reason = GATEWAY_ERRORS.includes(status)
    ? `Infer could not be reached (tried ${ATTEMPTS} times). Try again in a minute.`
    : "no result returned.";
  throw new StudioError(502, `Infer error ${status}: ${reason}`);
}

export async function listModels() {
  const config = inferConfig();
  const response = await fetch(`${config.url}/v1/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as InferBody & {
    models?: { id: string; reasoningEfforts: string[] }[];
  };
  if (!response.ok || !body.models?.length) {
    const code = body.code ? `${body.code}: ` : "";
    throw new StudioError(502, `Infer error ${response.status}: ${code}${body.message ?? "the model list did not load."}`);
  }
  return body.models.map((model) => ({ id: model.id, reasoningEfforts: model.reasoningEfforts }));
}

// Text with a JSON schema. The model sees the Bucket images with the prompt.
export async function generateJson(prompt: string, schema: object, imageBucketFileIds: string[], choice: InferChoice) {
  const result = await request(
    {
      type: "generate",
      input: {
        prompt,
        model: choice.model,
        reasoningEffort: choice.reasoningEffort,
        webSearch: false,
        schema,
        ...(imageBucketFileIds.length ? { imageBucketFileIds } : {}),
      },
    },
    600_000,
  );
  return result.output;
}

// One image. referencePng is the image Infer copies from (a PNG of 2 MiB or less).
export async function generateImage(prompt: string, referencePng: Buffer | null, choice: InferChoice) {
  await takeImageSlot();
  try {
    const result = await request(
      {
        type: "images",
        input: {
          prompt,
          model: choice.model,
          reasoningEffort: choice.reasoningEffort,
          ...(referencePng ? { referenceImage: referencePng.toString("base64") } : {}),
        },
      },
      330_000,
    );
    if (typeof result.image !== "string") throw new StudioError(502, "Infer error: no image returned.");
    return Buffer.from(result.image, "base64");
  } finally {
    releaseImageSlot();
  }
}
