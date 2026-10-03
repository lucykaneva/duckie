// Dev A's one place that calls Grok text. The HTTP call can be replaced in tests.
// The key is read from the environment and never logged.

const ENDPOINT = "https://api.x.ai/v1/chat/completions";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type AiFailure = "no_key" | "timeout" | "http" | "bad_output";

/** Thrown when Grok can't be used this turn. Callers fall back to code-only evaluation. */
export class AiError extends Error {
  constructor(
    public reason: AiFailure,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface ChatOptions {
  model: string;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
  /** Ask for a single JSON object. */
  json?: boolean;
  fetchImpl?: FetchLike;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One chat call, no retry: the duck cannot wait for a second attempt. */
export async function chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new AiError("no_key", "XAI_API_KEY is not set");
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));

  let response: Response;
  try {
    response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AiError(timedOut ? "timeout" : "http", timedOut ? "Grok timed out" : "Could not reach Grok");
  }
  if (!response.ok) throw new AiError("http", `Grok returned ${response.status}`);

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AiError("bad_output", "Grok returned no text");
  return content;
}
