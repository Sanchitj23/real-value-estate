/** Low-cost model used for the in-app assistant. Extraction keeps its own model constant in engine/extraction.ts. */
export const ASSISTANT_MODEL = "openai/gpt-6-luna";

type StreamEvent = {
  type?: string; delta?: string; error?: { message?: string };
  response?: { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>; error?: { message?: string } };
};

/**
 * One structured-output call to the Lovable AI gateway (Responses API, streamed). Same request shape as extraction.
 * Throws a readable error for rate limits (429) and exhausted workspace credits (402).
 */
export async function askJson<T>(opts: { system: string; user: string; schemaName: string; schema: object; timeoutMs?: number }): Promise<T> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured on this server.");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    headers: { "Lovable-API-Key": key, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: ASSISTANT_MODEL,
      instructions: opts.system,
      input: [{ role: "user", content: opts.user }],
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      text: { format: { type: "json_schema", name: opts.schemaName, strict: true, schema: opts.schema } },
    }),
  });
  if (!resp.ok || !resp.body) {
    const body = await resp.text().catch(() => "");
    throw new Error(resp.status === 429 ? "AI rate limit reached — try again in a moment." : resp.status === 402 ? "AI credits for this workspace are exhausted." : `AI error ${resp.status}: ${body.slice(0, 200)}`);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", completed = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: StreamEvent;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === "response.output_text.delta" && ev.delta) out += ev.delta;
      else if (ev.type === "error" || ev.type === "response.failed") throw new Error(ev.error?.message ?? ev.response?.error?.message ?? "AI stream failed");
      else if (ev.type === "response.completed") {
        completed = (ev.response?.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
      }
    }
  }
  const text = out || completed;
  if (!text) throw new Error("AI returned an empty answer.");
  return JSON.parse(text) as T;
}
