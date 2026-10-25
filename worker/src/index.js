// Proxy du coach IA de Créneau : garde la clé API Anthropic côté serveur.
// POST /json  {prompt}    → ajustement du check-in, objet JSON {intensite, zones_a_eviter, message}
// POST /chat  {messages}  → débrief / chat, flux SSE "data: {"text": "..."}" puis "data: {"done": true}"
// GET|PUT /backup         → sauvegarde des données de l'app dans KV (document unique)
import Anthropic from "@anthropic-ai/sdk";

const MAX_BODY = 40_000;     // octets
const MAX_BACKUP = 1_000_000;
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

// modifications de séance proposées depuis le chat ; champs inutilisés : "" ou 0
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["swap", "reps", "kg", "rounds", "remove"] },
          ex: { type: "string" },
          to: { type: "string" },
          bloc: { type: "integer" },
          value: { type: "number" },
        },
        required: ["op", "ex", "to", "bloc", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["message", "changes"],
  additionalProperties: false,
};

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "origin" }, 403, cors);
    if (!env.ACCESS_CODE || req.headers.get("X-Access-Code") !== env.ACCESS_CODE) return json({ error: "unauthorized" }, 401, cors);
    if (new URL(req.url).pathname === "/backup") return backup(req, env, cors);
    if (req.method !== "POST") return json({ error: "method" }, 405, cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413, cors);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400, cors); }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    const path = new URL(req.url).pathname;
    try {
      if (path === "/json") return await adjust(client, body, cors);
      if (path === "/plan") return await plan(client, body, cors);
      if (path === "/chat") return chat(client, body, cors);
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      // le détail renvoyé vient de l'API Anthropic (type d'erreur, message) : pas de secret dedans
      console.error(path, e?.status, e?.message);
      return json({ error: "upstream", status: e?.status ?? null, detail: String(e?.message || e).slice(0, 300) },
        e instanceof Anthropic.RateLimitError ? 429 : 502, cors);
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

async function plan(client, body, cors) {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return json({ error: "prompt" }, 400, cors);
  const res = await client.beta.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
    system: "Tu es un coach sportif concis. Réponds en français, en texte brut sans markdown ni emoji.",
    messages: [{ role: "user", content: body.prompt }],
  });
  if (res.stop_reason === "refusal") return json({ message: "Je ne peux pas répondre à ça.", changes: [] }, 200, cors);
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
      console.error("/chat", e?.status, e?.message);
      await send({ error: e instanceof Anthropic.RateLimitError ? "rate_limited" : "upstream" });
    } finally {
      await w.close();
    }
  })();

  return new Response(readable, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

async function backup(req, env, cors) {
  if (!env.BACKUP) return json({ error: "no_storage" }, 501, cors);
  if (req.method === "GET") {
    const data = await env.BACKUP.get("data");
    if (!data) return json({ error: "empty" }, 404, cors);
    return new Response(data, { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (req.method !== "PUT") return json({ error: "method" }, 405, cors);
  const raw = await req.text();
  if (raw.length > MAX_BACKUP) return json({ error: "too_large" }, 413, cors);
  let v;
  try { v = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400, cors); }
  if (v?.app !== "creneau" || !Array.isArray(v.sessions)) return json({ error: "bad_backup" }, 400, cors);
  const at = Date.now();
  await env.BACKUP.put("data", raw, { metadata: { at } });
  return json({ ok: true, at }, 200, cors);
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Access-Code", "Vary": "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
