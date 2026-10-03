// Mints a short-lived Grok Voice token so the browser never sees XAI_API_KEY.
export async function POST() {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "XAI_API_KEY is not set" }, { status: 500 });
  }

  const res = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ expires_after: { seconds: 300 } }),
  });

  if (!res.ok) {
    return Response.json(
      { error: `xAI returned ${res.status}: ${await res.text()}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
  };
  const token = data.value ?? data.client_secret?.value;
  if (!token) {
    return Response.json(
      { error: `Unexpected token response: ${JSON.stringify(data)}` },
      { status: 502 },
    );
  }

  return Response.json({
    token,
    expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? null,
  });
}
