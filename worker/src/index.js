// Proxy du coach IA de Créneau : garde la clé API Anthropic côté serveur.
// POST /json  {prompt}    → ajustement du check-in, objet JSON {intensite, zones_a_eviter, message}
// POST /chat  {messages}  → débrief / chat, flux SSE "data: {"text": "..."}" puis "data: {"done": true}"
import Anthropic from "@anthropic-ai/sdk";

const MAX_BODY = 40_000;     // octets
const MAX_MESSAGES = 24;
const ZONES = ["epaule", "coude", "poignet", "dos", "genou"];

const ADJUST_SCHEMA = {
  type: "object",
  properties: {
    intensite: { type: "integer", enum: [-1, 0, 1] },
    zones_a_eviter: { type: "array", items: { type: "string", enum: ZONES } },
    message: { type: "string" },
  },
  required: ["intensite", "zones_a_eviter", "message"],
  additionalProperties: false,
};

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ error: "method" }, 405, cors);
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "origin" }, 403, cors);
    if (!env.ACCESS_CODE || req.headers.get("X-Access-Code") !== env.ACCESS_CODE) return json({ error: "unauthorized" }, 401, cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413, cors);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400, cors); }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    const path = new URL(req.url).pathname;
    try {
      if (path === "/json") return await adjust(client, body, cors);
      if (path === "/chat") return chat(client, body, cors);
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      return json({ error: "upstream" }, e instanceof Anthropic.RateLimitError ? 429 : 502, cors);
    }
  },
};

async function adjust(client, body, cors) {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return json({ error: "prompt" }, 400, cors);
  const res = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: ADJUST_SCHEMA } },
    messages: [{ role: "user", content: body.prompt }],
  });
  if (res.stop_reason === "refusal") return json({ intensite: -1, zones_a_eviter: [], message: "Le coach ne peut pas répondre à ça : séance standard allégée." }, 200, cors);
  const text = res.content.find(b => b.type === "text")?.text;
  if (!text) return json({ error: "empty" }, 502, cors);
  return json(JSON.parse(text), 200, cors);
}

function chat(client, body, cors) {
  const msgs = Array.isArray(body.messages) ? body.messages : null;
  const valid = msgs && msgs.length && msgs.length <= MAX_MESSAGES && msgs[0].role === "user" &&
    msgs.every(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  if (!valid) return json({ error: "messages" }, 400, cors);

  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const send = obj => w.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  (async () => {
    try {
      const stream = client.beta.messages.stream({
        model: "claude-sonnet-5-5",
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: "Tu es un coach sportif concis. Réponds en français, en texte brut sans markdown ni emoji.",
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
      });
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") await send({ text: ev.delta.text });
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") await send({ text: "\n(Le coach ne peut pas répondre à cette question.)" });
      await send({ done: true });
    } catch (e) {
      await send({ error: e instanceof Anthropic.RateLimitError ? "rate_limited" : "upstream" });
    } finally {
      await w.close();
    }
  })();

  return new Response(readable, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Access-Code", "Vary": "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
