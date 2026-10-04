import { EXTRACT } from "../duck/config";
import { ExtractError } from "./errors";

// The only place Dev B's code talks to xAI. The HTTP call can be replaced in tests.
// The key is read from the environment (.env.local, or .env) and never logged.

const ENDPOINT = "https://api.x.ai/v1/chat/completions";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GrokOptions {
  model: string;
  timeoutMs: number;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  fetchImpl?: FetchLike;
}

export type GrokContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "high" | "low" | "auto" } }
    >;

export interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: GrokContent;
}

const DIDNT_RESPOND = "The AI service didn't respond. Wait a moment and try again.";
const KEY_REJECTED = "The AI service rejected the server key. Check XAI_API_KEY on the host.";
const TOOK_TOO_LONG = "The AI service took too long. Try a smaller file.";

/** Vercel env pastes often keep quotes or a trailing newline. Those still count as "set" and then get rejected. */
function apiKeyFromEnv(): string {
  const raw = process.env.XAI_API_KEY?.trim() ?? "";
  return raw.replace(/^['"]|['"]$/g, "").trim();
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function refusal(response: Response): Promise<ExtractError> {
  if (response.status === 401 || response.status === 403) {
    return new ExtractError("ai_unavailable", KEY_REJECTED);
  }
  let detail = "";
  try {
    const body = (await response.json()) as { error?: unknown };
    const err = body.error;
    const message =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "";
    detail = message.replace(/\s+/g, " ").trim().slice(0, 140);
  } catch {
    detail = "";
  }
  console.error(`xAI chat failed: ${response.status}${detail ? ` ${detail}` : ""}`);
  const text = detail ? `The AI service didn't respond (${response.status}: ${detail}).` : DIDNT_RESPOND;
  return new ExtractError("ai_unavailable", text);
}

/** One chat call. Retries once on a network error, 429 or 5xx. A timeout is not retried: the function would already be out of time. */
export async function callGrok(messages: GrokMessage[], options: GrokOptions): Promise<string> {
  const apiKey = apiKeyFromEnv();
  if (!apiKey) {
    throw new ExtractError("ai_unavailable", "The AI service isn't set up on the server (missing key).");
  }
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));

  const body = JSON.stringify({
    model: options.model,
    messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens,
    ...(options.json ? { response_format: { type: "json_object" } } : {}),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await doFetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (response.status === 429 || response.status >= 500) continue;
      if (!response.ok) throw await refusal(response);
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ExtractError("ai_unavailable", DIDNT_RESPOND);
      return content;
    } catch (error) {
      if (error instanceof ExtractError) throw error;
      if (isTimeout(error)) throw new ExtractError("ai_unavailable", TOOK_TOO_LONG);
      // Network error: try once more.
    }
  }
  throw new ExtractError("ai_unavailable", DIDNT_RESPOND);
}

const TRANSCRIBE_PROMPT =
  "Transcribe this handwritten or scanned page exactly. Write math as LaTeX. " +
  "Describe any diagram in one line. Return plain text only. " +
  "Output only what is written on the page: do not describe the image itself, " +
  "and do not add an introduction or a closing remark.";

/** Transcribe one page image with Grok vision. Returns plain text (may be empty for a blank page). */
export async function transcribePage(
  image: { bytes: Uint8Array; mime: string },
  fetchImpl?: FetchLike,
): Promise<string> {
  const base64 = Buffer.from(image.bytes).toString("base64");
  const text = await callGrok(
    [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${image.mime};base64,${base64}`, detail: "high" } },
          { type: "text", text: TRANSCRIBE_PROMPT },
        ],
      },
    ],
    { model: EXTRACT.visionModel, timeoutMs: EXTRACT.visionTimeoutMs, maxTokens: 3_000, fetchImpl },
  );
  return text.trim();
}
