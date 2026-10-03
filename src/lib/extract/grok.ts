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

const unavailable = (): ExtractError =>
  new ExtractError("ai_unavailable", "The AI service didn't respond. Wait a moment and try again.");

/** One chat call. Retries once on a network error, timeout, 429 or 5xx. */
export async function callGrok(messages: GrokMessage[], options: GrokOptions): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
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
      if (!response.ok) throw unavailable();
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw unavailable();
      return content;
    } catch (error) {
      if (error instanceof ExtractError) throw error;
      // Network error or timeout: try once more.
    }
  }
  throw unavailable();
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
