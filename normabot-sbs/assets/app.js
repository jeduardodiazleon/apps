/* NormaBot SBS — chatbot estático para GitHub Pages.
 * Flujo: pregunta → búsqueda local (BM25) en la normativa indexada → IA (Gemini) con
 * las reglas de config/reglas.md → respuesta con citas a la Resolución SBS de origen.
 * Normalmente no necesitas tocar este archivo: el comportamiento se ajusta en
 * config/reglas.md (reglas) y config/config.json (ajustes técnicos).
 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const estado = {
    config: null, reglas: "", meta: null,
    normas: new Map(),      // id -> norma
    docs: [],               // unidades de búsqueda (fichas + fragmentos)
    indice: null,
    historial: [],          // [{role, content}]
    ocupado: false,
  };

  // ------------------------------------------------------------------ utilidades
  const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STOP = new Set(("a al algo algun alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aqui asi " +
    "aun bajo bien cada cual cuales cuando como con contra cual cualquier cuya cuyo de del desde donde dos el ella ellas " +
    "ellos en entre era es esa esas ese eso esos esta estas este esto estos fue fueron ha han hasta hay la las le les lo " +
    "los mas me mi mis muy ni no nos o otra otras otro otros para pero poco por porque que quien quienes se sea segun ser " +
    "si sido sin sino sobre su sus tal tambien tanto te tiene tienen todo todos tu un una unas uno unos y ya cuales cual " +
    "debe deben puede pueden dicha dicho dichas dichos asimismo mediante cuya cuyas cuyos establece establecen norma normas " +
    "resolucion sbs articulo articulos numeral literal inciso empresa empresas sistema financiero financiera superintendencia " +
    "dime explica explicame quiero saber consulta favor regula regulan").split(" "));

  const normalizar = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function raiz(t) {
    // Lematizador ligero para español (suficiente para búsqueda)
    for (const suf of ["aciones", "imientos", "amientos", "idades", "iciones", "acion", "amiento", "imiento", "idad", "mente", "ciones", "icios", "icias", "icio", "icia", "cion", "es", "s"]) {
      if (t.length - suf.length >= 4 && t.endsWith(suf)) { t = t.slice(0, -suf.length); break; }
    }
    // quita la vocal final: crédito/crediticio → credit, riesgo → riesg
    return t.length > 5 && /[aeo]$/.test(t) ? t.slice(0, -1) : t;
  }

  function tokens(texto) {
    const out = [];
    for (const t of normalizar(texto).split(/[^a-z0-9ñ]+/)) {
      if (t.length < 3 || STOP.has(t) || /^\d+$/.test(t)) continue;
      out.push(raiz(t));
    }
    return out;
  }

  // Números de norma tipo "11356-2008", "N° 3274-2017", "G-140-2009"
  const numerosNorma = (s) => (normalizar(s).match(/\b[a-z]{0,6}-?\d{1,5}-\d{2,4}\b/g) || [])
    .map((n) => n.replace(/^([a-z]*-?)0+(\d)/, "$1$2"));

  const fechaClave = (d) => (d && d.length >= 10 ? d.slice(6, 10) + d.slice(3, 5) + d.slice(0, 2) : "00000000");
  const esVigente = (n) => /^(vigente|modificada)/i.test(n?.estado || "");

  async function cargarJSON(ruta, porDefecto) {
    try {
      const r = await fetch(ruta, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      if (porDefecto !== undefined) return porDefecto;
      throw new Error(`No se pudo cargar ${ruta}`);
    }
  }

  // ------------------------------------------------------------------ índice BM25
  function construirIndice(docs) {
    const df = new Map(), largo = [], tf = [];
    let total = 0;
    docs.forEach((d, i) => {
      const tk = tokens(d.busqueda);
      const m = new Map();
      for (const t of tk) m.set(t, (m.get(t) || 0) + 1);
      tf[i] = m; largo[i] = tk.length; total += tk.length;
      for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
    });
    const invertido = new Map();
    tf.forEach((m, i) => { for (const [t, f] of m) { if (!invertido.has(t)) invertido.set(t, []); invertido.get(t).push([i, f]); } });
    return { df, largo, invertido, N: docs.length, prom: total / Math.max(1, docs.length) };
  }

  const idfDe = (t) => {
    const { df, N } = estado.indice;
    return df.has(t) ? Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5)) : 0;
  };

  // Pares de palabras consecutivas de la consulta ("riesgo operacional", "plazo reclamo"...)
  const pares = (tk) => tk.slice(1).map((t, i) => tk[i] + " " + t);

  function buscar(consulta) {
    const cfg = estado.config.busqueda;
    const { largo, invertido, prom } = estado.indice;
    const k1 = 1.4, b = 0.75;
    const tkConsulta = tokens(consulta);
    const terminos = [...new Set(tkConsulta)].filter((t) => invertido.has(t));
    const nums = numerosNorma(consulta);
    if (!terminos.length && !nums.length) return [];

    const pesoTotal = terminos.reduce((a, t) => a + idfDe(t), 0) || 1;
    const bm25 = new Map(), cubierto = new Map();
    for (const t of terminos) {
      const idf = idfDe(t);
      for (const [i, f] of invertido.get(t)) {
        bm25.set(i, (bm25.get(i) || 0) + idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * largo[i] / prom)));
        cubierto.set(i, (cubierto.get(i) || 0) + idf);
      }
    }

    // Si se menciona un número de norma (p. ej. 11356-2008), la búsqueda se limita a esa norma
    let soloNormas = null;
    if (nums.length) {
      soloNormas = new Set([...estado.normas.values()].filter((n) => nums.some((x) => n._nums.includes(x))).map((n) => n.id));
      if (!soloNormas.size) soloNormas = null;
      else estado.docs.forEach((d, i) => { if (soloNormas.has(d.nid) && !bm25.has(i)) { bm25.set(i, 0.1); cubierto.set(i, 0); } });
    }

    const minCobertura = terminos.length <= 1 ? 1 : terminos.length === 2 ? 0.75 : cfg.cobertura_minima;
    const paresConsulta = pares(tkConsulta);
    let res = [];
    for (const [i, base] of bm25) {
      const d = estado.docs[i], n = estado.normas.get(d.nid);
      if (soloNormas && !soloNormas.has(d.nid)) continue;
      const cobertura = (cubierto.get(i) || 0) / pesoTotal;
      if (!soloNormas && cobertura < minCobertura) continue;   // deben coincidir la mayoría de los términos importantes
      let s = base * (0.2 + 0.8 * cobertura * cobertura);
      if (soloNormas) s += 20;
      if (cfg.priorizar_vigentes && !esVigente(n)) s *= cfg.factor_no_vigente;
      if (d.tipo === "ficha") {
        s *= 0.85;
        // Ante una misma coincidencia, la norma principal (reglamento) va antes que sus modificatorias
        if (n._principal) s *= 1.35; else if (n._modificatoria) s *= 0.8;
      }
      res.push({ d, n, s, i, cobertura });
    }
    res.sort((a, b) => b.s - a.s);

    // Bonificación por frases: los pares de palabras que aparecen juntos pesan mucho más
    if (paresConsulta.length) {
      for (const r of res.slice(0, 60)) {
        const tk = tokens(r.d.busqueda);
        const enDoc = new Set(pares(tk));
        const hits = paresConsulta.filter((p) => enDoc.has(p)).length;
        r.s *= 1 + 0.6 * hits;
      }
      res.sort((a, b) => b.s - a.s);
    }

    if (!res.length || res[0].s < cfg.puntaje_minimo) return [];
    const corte = res[0].s * cfg.relativo_al_mejor;          // se descarta lo que queda muy por debajo del mejor
    const porNorma = new Map(), elegidos = [];
    for (const r of res) {
      if (r.s < corte) break;
      const c = porNorma.get(r.d.nid) || 0;
      if (c >= cfg.max_fragmentos_por_norma) continue;
      porNorma.set(r.d.nid, c + 1);
      elegidos.push(r);
      if (elegidos.length >= cfg.fragmentos_por_consulta) break;
    }
    return elegidos;
  }

  // ------------------------------------------------------------------ IA
  function modoIA() {
    const ia = estado.config.ia;
    const clave = localStorage.getItem("normabot_gemini_key");
    if (ia.modo === "worker" && ia.worker_url && !ia.worker_url.includes("TU-WORKER")) return "worker";
    if (ia.modo === "sin_ia") return "sin_ia";
    return clave ? "clave_propia" : "sin_ia";
  }

  function bloqueContexto(resultados) {
    return resultados.map((r, k) => {
      const n = r.n;
      const cab = `[F${k + 1}] ${n.norma} | Estado: ${n.estado || "s/d"} | Emisión: ${n.fecha_emision || "s/d"}` +
        (n.temas?.length ? ` | Temas: ${n.temas.join(", ")}` : "");
      const cuerpo = r.d.tipo === "ficha"
        ? `Tipo: FICHA (solo sumilla, sin texto completo indexado)\nSumilla: ${n.sumilla}`
        : `Sumilla: ${n.sumilla}\nSección: ${r.d.seccion}\nTexto: ${r.d.texto}`;
      return `${cab}\n${cuerpo}`;
    }).join("\n\n---\n\n");
  }

  // Los modelos Gemini más recientes ya no aceptan "temperature": solo se envía si config lo define
  const configGeneracion = (ia) => Object.assign({ maxOutputTokens: ia.max_tokens_respuesta },
    typeof ia.temperatura === "number" ? { temperature: ia.temperatura } : {});

  async function llamarIA(pregunta, resultados) {
    const ia = estado.config.ia;
    const contenido = `FRAGMENTOS DE NORMATIVA (única fuente permitida):\n\n${bloqueContexto(resultados)}\n\n` +
      `PREGUNTA DEL USUARIO:\n${pregunta}`;
    const mensajes = [...estado.historial.slice(-ia.turnos_de_historial * 2).map(({ role, content }) => ({ role, content })),
      { role: "user", content: contenido }];
    const modo = modoIA();

    if (modo === "worker") {
      const r = await fetch(ia.worker_url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: estado.reglas, messages: mensajes, model: ia.modelo,
          temperature: ia.temperatura, max_tokens: ia.max_tokens_respuesta }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error del servidor (${r.status})`);
      return j.text;
    }
    // clave_propia: llamada directa a la API de Gemini desde el navegador
    const clave = localStorage.getItem("normabot_gemini_key");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ia.modelo)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: estado.reglas }] },
        contents: mensajes.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: configGeneracion(ia),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Error de Gemini (${r.status})`);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  }

  // ------------------------------------------------------------------ render
  const urlNorma = (id) => estado.config.citas.url_detalle_norma.replace("{id}", encodeURIComponent(id));

  function markdownSimple(texto) {
    const lineas = escapar(texto).split("\n");
    let html = "", enLista = false;
    for (let l of lineas) {
      l = l.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
      const item = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
      if (item) { if (!enLista) { html += "<ul>"; enLista = true; } html += `<li>${item[1]}</li>`; continue; }
      if (enLista) { html += "</ul>"; enLista = false; }
      const h = l.match(/^#{1,4}\s+(.*)/);
      if (h) html += `<p class="h">${h[1]}</p>`;
      else if (l.trim()) html += `<p>${l}</p>`;
    }
    if (enLista) html += "</ul>";
    return html;
  }

  function enlazarCitas(html, resultados, usados) {
    return html.replace(/\[F(\d+)(?:\s*[,;]\s*F?(\d+))*\]/g, (m) => {
      return m.slice(1, -1).split(/[,;]\s*/).map((x) => {
        const k = parseInt(x.replace(/\D/g, ""), 10) - 1;
        const r = resultados[k];
        if (!r) return "";
        usados.add(k);
        return `<a class="cita" href="${urlNorma(r.n.id)}" target="_blank" rel="noopener" title="${escapar(r.n.norma)}">${k + 1}</a>`;
      }).join("");
    });
  }

  function listaFuentes(resultados, indices) {
    const vistos = new Set(), items = [];
    for (const k of indices) {
      const r = resultados[k];
      if (!r || vistos.has(r.n.id)) continue;
      vistos.add(r.n.id);
      const sec = r.d.tipo === "ficha" ? "" : ` · ${escapar(r.d.seccion)}`;
      items.push(`<li><a href="${urlNorma(r.n.id)}" target="_blank" rel="noopener">${escapar(r.n.norma)}</a>` +
        `<span class="sumilla">${escapar(r.n.sumilla)}</span>` +
        `<span class="metadatos ${esVigente(r.n) ? "ok" : "no"}">${escapar(r.n.estado || "")} · emitida ${escapar(r.n.fecha_emision || "s/d")}${sec}</span></li>`);
    }
    return items.length ? `<div class="fuentes"><p>Fuentes (Compendio SBS)</p><ol>${items.join("")}</ol></div>` : "";
  }

  function fechaDatos() {
    const m = estado.meta || {};
    if (m.fecha_corte) return m.fecha_corte;
    if (!m.actualizado) return "s/d";
    const d = new Date(m.actualizado);
    return [d.getDate(), d.getMonth() + 1].map((x) => String(x).padStart(2, "0")).join("/") + "/" + d.getFullYear();
  }
  const sello = () => `<p class="sello">${escapar(estado.config.citas.texto_fecha_datos.replace("{fecha}", fechaDatos()))}</p>`;

  function agregarMensaje(rol, html) {
    const div = document.createElement("div");
    div.className = `msg ${rol}`;
    div.innerHTML = html;
    if (rol === "bot") {
      const fila = document.createElement("div");
      fila.className = "fila-bot";
      fila.innerHTML = '<img class="avatar" src="assets/avatar.webp" alt="" width="36" height="36">';
      fila.appendChild(div);
      $("#mensajes").appendChild(fila);
    } else {
      $("#mensajes").appendChild(div);
    }
    div.scrollIntoView({ behavior: "smooth", block: "end" });
    return div;
  }

  // Respuesta sin IA: extrae del artículo más pertinente las oraciones que responden la pregunta
  function oracionesClave(texto, pregunta, max = 3) {
    const q = new Set(tokens(pregunta));
    const oraciones = texto.split(/(?<=[.;:])\s+(?=[A-ZÁÉÍÓÚÑ0-9(¿"“])/).filter((o) => o.length > 25);
    const puntuadas = oraciones.map((o, i) => {
      const tk = new Set(tokens(o));
      let p = 0; for (const t of q) if (tk.has(t)) p += idfDe(t);
      return { o, i, p };
    }).filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, max).sort((a, b) => a.i - b.i);
    return puntuadas.map((x) => x.o.length > 600 ? x.o.slice(0, 600) + "…" : x.o);
  }

  function respuestaSinIA(pregunta, resultados) {
    const conTexto = resultados.filter((r) => r.d.tipo === "texto");
    const cita = (r) => `[F${resultados.indexOf(r) + 1}]`;
    if (conTexto.length) {
      const r = conTexto[0];
      const frases = oracionesClave(r.d.texto, pregunta);
      let t = `Según el **${r.d.seccion}** de la **${r.n.norma}**:\n\n` +
        (frases.length ? frases.map((f) => `«${f}»`).join("\n\n") : `«${r.d.texto.slice(0, 600)}…»`) + ` ${cita(r)}`;
      const otros = conTexto.slice(1).filter((x) => x.n.id !== r.n.id).slice(0, 2);
      if (otros.length) t += "\n\nTambién se relaciona con:\n" + otros.map((x) => `- ${x.d.seccion} de la **${x.n.norma}** ${cita(x)}`).join("\n");
      return t;
    }
    const r = resultados[0];
    let t = `La norma que mejor coincide con tu consulta es la **${r.n.norma}**: «${r.n.sumilla}» ${cita(r)}`;
    const otros = resultados.slice(1, 3).filter((x) => x.n.id !== r.n.id);
    if (otros.length) t += "\n\nTambién se relacionan:\n" + otros.map((x) => `- **${x.n.norma}**: ${x.n.sumilla} ${cita(x)}`).join("\n");
    t += "\n\n*Aún no está cargado el texto completo de las normas, por eso solo puedo indicarte qué norma regula el tema. " +
      "Cuando se ejecute la actualización completa podré responder con el contenido de cada artículo.*";
    return t;
  }

  // ------------------------------------------------------------------ flujo principal
  async function enviar(pregunta) {
    pregunta = pregunta.trim();
    if (!pregunta || estado.ocupado) return;
    estado.ocupado = true;
    $("#enviar").disabled = true;
    agregarMensaje("usuario", `<p>${escapar(pregunta)}</p>`);
    const pensando = agregarMensaje("bot", '<p class="pensando">Buscando en la normativa SBS…</p>');

    try {
      // Para preguntas de seguimiento cortas, se suma la pregunta anterior a la búsqueda
      const anterior = estado.historial.filter((m) => m.role === "user").slice(-1)[0]?.pregunta || "";
      const esSeguimiento = /^\s*¿?\s*(y|e|pero|entonces|en ese caso|tambi[eé]n|sobre eso|de eso|eso|esa|ese|dicha|dicho|cu[aá]l(es)? (es|son) (el|la|los|las) (plazo|requisito|sanci[oó]n))\b/i.test(pregunta)
        || /\b(esa norma|esta norma|dicha norma|esa resoluci[oó]n|lo anterior)\b/i.test(pregunta);
      let resultados = buscar(pregunta);
      if (anterior && esSeguimiento && !numerosNorma(pregunta).length) {
        const combinados = buscar(anterior + " " + pregunta);
        if (combinados.length) resultados = combinados;
      }

      if (!resultados.length) {
        pensando.innerHTML = `<p>${escapar(estado.config.citas.mensaje_sin_resultados)}</p>` + sello();
        return;
      }
      const modo = modoIA();
      let texto;
      if (modo === "sin_ia") {
        texto = respuestaSinIA(pregunta, resultados);
      } else {
        pensando.innerHTML = '<p class="pensando">Redactando la respuesta…</p>';
        texto = await llamarIA(pregunta, resultados);
        if (!texto) throw new Error("La IA no devolvió texto.");
      }

      const usados = new Set();
      let html = enlazarCitas(markdownSimple(texto), resultados, usados);
      let indices = [...usados].sort((a, b) => a - b);
      if (!indices.length && estado.config.citas.forzar_lista_de_fuentes) indices = resultados.map((_, k) => k);
      html += listaFuentes(resultados, indices) + sello();
      pensando.innerHTML = html;

      const sinCitas = !usados.size && modo !== "sin_ia";
      if (sinCitas) pensando.querySelector(".sello").insertAdjacentHTML("beforebegin",
        '<p class="aviso">La respuesta no marcó citas concretas; se listan las normas consultadas.</p>');

      estado.historial.push({ role: "user", content: pregunta, pregunta },
        { role: "assistant", content: texto.replace(/\[F[\dF,;\s]+\]/g, "") });
    } catch (e) {
      pensando.innerHTML = `<p class="error">No pude completar la consulta: ${escapar(e.message)}</p>`;
    } finally {
      estado.ocupado = false;
      $("#enviar").disabled = false;
      $("#entrada").focus();
    }
  }

  function prepararDocs(catalogo, fragmentos) {
    for (const n of catalogo) {
      n._nums = numerosNorma(n.norma);
      n._principal = /^(aprueba[n]?\s+(el\s+)?(nuevo\s+)?reglamento|nuevo reglamento|reglamento|norma que regula|normas para)/i.test(n.sumilla || "");
      n._modificatoria = /^(modific|sustitu|ampl[ií]a|incorpora|precisa|prorroga|elimina|deroga)/i.test(n.sumilla || "");
      estado.normas.set(n.id, n);
      estado.docs.push({ tipo: "ficha", nid: n.id,
        busqueda: `${n.norma} ${n.sumilla} ${n.sumilla} ${(n.temas || []).join(" ")}` });
    }
    for (const f of fragmentos) {
      const n = estado.normas.get(f.n);
      if (!n) continue;
      estado.docs.push({ tipo: "texto", nid: f.n, seccion: f.s, texto: f.t,
        busqueda: `${n.sumilla} ${f.s} ${f.t}` });
    }
  }

  function pintarEstadoIA() {
    const modo = modoIA();
    const txt = { worker: "IA activa", clave_propia: "IA activa (tu clave)", sin_ia: "Modo búsqueda (sin IA)" }[modo];
    $("#modo").textContent = txt;
    $("#modo").className = `modo ${modo}`;
  }

  async function iniciar() {
    try {
      estado.config = await cargarJSON("config/config.json");
      const ui = estado.config.interfaz;
      document.title = ui.titulo;
      $("#titulo").textContent = ui.titulo;
      $("#subtitulo").textContent = ui.subtitulo;
      $("#aviso-legal").textContent = ui.aviso_legal;

      const [reglas, meta, catalogo] = await Promise.all([
        fetch("config/reglas.md", { cache: "no-cache" }).then((r) => r.text()),
        cargarJSON("data/meta.json", {}),
        cargarJSON("data/catalogo.json", []),
      ]);
      estado.reglas = reglas.replace(/<!--[\s\S]*?-->/g, "").trim();
      estado.meta = meta;
      const lotes = await Promise.all((meta.archivos_fragmentos || []).map((a) => cargarJSON(`data/${a}`, [])));
      prepararDocs(catalogo, lotes.flat());
      estado.indice = construirIndice(estado.docs);

      $("#base").textContent = `${catalogo.length} normas · ${meta.fragmentos || 0} fragmentos de texto · ` +
        estado.config.citas.texto_fecha_datos.replace("{fecha}", fechaDatos());

      agregarMensaje("bot", markdownSimple(ui.bienvenida));
      const ej = $("#ejemplos");
      for (const e of ui.ejemplos || []) {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = e;
        b.onclick = () => { ej.remove(); enviar(e); };
        ej.appendChild(b);
      }
      pintarEstadoIA();
    } catch (e) {
      agregarMensaje("bot", `<p class="error">Error al iniciar: ${escapar(e.message)}</p>`);
    }
  }

  // ------------------------------------------------------------------ eventos
  $("#formulario").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = $("#entrada").value;
    $("#entrada").value = "";
    $("#ejemplos")?.remove();
    enviar(v);
  });
  $("#entrada").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $("#formulario").requestSubmit(); }
  });
  $("#ajustes").addEventListener("click", () => {
    $("#clave").value = localStorage.getItem("normabot_gemini_key") || "";
    $("#dialogo").showModal();
  });
  $("#guardar-clave").addEventListener("click", () => {
    const v = $("#clave").value.trim();
    if (v) localStorage.setItem("normabot_gemini_key", v); else localStorage.removeItem("normabot_gemini_key");
    pintarEstadoIA();
  });
  $("#nueva").addEventListener("click", () => {
    estado.historial = [];
    $("#mensajes").innerHTML = "";
    agregarMensaje("bot", markdownSimple(estado.config.interfaz.bienvenida));
  });

  iniciar();
})();
