/**
 * Cloudflare Worker (plan gratuito) que hace de intermediario entre el chatbot y Gemini.
 * Mantiene tu clave de API en secreto: nunca llega al navegador de los visitantes.
 *
 * Variables (Cloudflare → Workers → tu worker → Settings → Variables):
 *   GEMINI_API_KEY   (secreto)  clave gratuita de https://aistudio.google.com/apikey
 *   ALLOWED_ORIGINS  (texto)    p. ej. https://tuusuario.github.io  (separa varias con comas)
 *   MODEL            (opcional) fuerza un modelo, p. ej. gemini-flash-latest
 */
const MAX_CARACTERES = 80_000;

export default {
  async fetch(req, env) {
    const origen = req.headers.get("Origin") || "";
    const permitidos = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
    const permitido = permitidos.includes("*") || permitidos.includes(origen);
    const cors = {
      "Access-Control-Allow-Origin": permitido ? (origen || "*") : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const responder = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!permitido) return responder({ error: "Origen no permitido" }, 403);
    if (req.method !== "POST") return responder({ error: "Usa POST" }, 405);
    if (!env.GEMINI_API_KEY) return responder({ error: "Falta configurar GEMINI_API_KEY en el Worker" }, 500);

    let cuerpo;
    try { cuerpo = await req.json(); } catch { return responder({ error: "JSON inválido" }, 400); }
    const { system = "", messages = [], temperature = null, max_tokens = 4096 } = cuerpo;
    if (!Array.isArray(messages) || !messages.length || messages.length > 20) return responder({ error: "Mensajes inválidos" }, 400);
    const total = system.length + messages.reduce((a, m) => a + String(m.content || "").length, 0);
    if (total > MAX_CARACTERES) return responder({ error: "Consulta demasiado larga" }, 413);

    const modelo = env.MODEL || (/^gemini-[\w.-]+$/.test(cuerpo.model || "") ? cuerpo.model : "gemini-flash-latest");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: String(system) }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] })),
        generationConfig: Object.assign({ maxOutputTokens: Math.min(+max_tokens || 4096, 8192) },
          typeof temperature === "number" ? { temperature: Math.min(Math.max(temperature, 0), 1) } : {}),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = r.status === 429 ? "Se alcanzó el límite gratuito de consultas por ahora. Intenta en unos minutos." : (j.error?.message || "Error de Gemini");
      return responder({ error: msg }, r.status);
    }
    const texto = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    return responder({ text: texto });
  },
};
