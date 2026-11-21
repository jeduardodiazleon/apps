/* Portada de apps: lee apps.json y dibuja la app destacada y el catálogo.
 * Para añadir o cambiar apps edita solo apps.json. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const ESTADOS = { activa: "", beta: "Beta", en_desarrollo: "En desarrollo" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  let datos, filtro = null, texto = "";

  const categoria = (app) => datos.categorias[app.categoria] || { nombre: "", color: "#46E07F" };

  function botones(app) {
    return `<div class="acciones">
      <a class="boton" href="${esc(app.ruta)}">Abrir ${esc(app.nombre)}</a>
      ${app.codigo ? `<a class="boton-fantasma" href="${esc(app.codigo)}" target="_blank" rel="noopener">Código</a>` : ""}
    </div>`;
  }

  function pintarResumen() {
    const n = datos.apps.length;
    const cats = new Set(datos.apps.map((a) => categoria(a).nombre)).size;
    $("#resumen").innerHTML = `<strong>${n} ${n === 1 ? "app" : "apps"}</strong> en ${cats} ${cats === 1 ? "categoría" : "categorías"}`;
  }

  function pintarDestacada() {
    const app = datos.apps.find((a) => a.destacada) || datos.apps[datos.apps.length - 1];
    if (!app) return;
    const el = $("#destacada");
    el.innerHTML = `
      ${app.imagen ? `<img class="imagen" src="${esc(app.imagen)}" alt="${esc(app.nombre)}" width="900" height="720">` : ""}
      <div class="velo"></div>
      <div class="info">
        <span class="sello">Destacada</span>
        <h3>${esc(app.nombre)}</h3>
        <p>${esc(app.resumen)}</p>
        ${botones(app)}
      </div>`;
    el.hidden = false;
  }

  function pintarFiltros() {
    const caja = $("#filtros");
    const usadas = Object.entries(datos.categorias).filter(([k]) => datos.apps.some((a) => a.categoria === k));
    const boton = (clave, nombre, color) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "filtro"; b.dataset.cat = clave ?? "";
      if (color) b.style.setProperty("--c", color);
      b.innerHTML = (color ? '<span class="punto" aria-hidden="true"></span>' : "") + esc(nombre);
      b.addEventListener("click", () => { filtro = clave; aplicar(); });
      return b;
    };
    caja.replaceChildren(boton(null, "Todas"), ...usadas.map(([k, c]) => boton(k, c.nombre, c.color)));
  }

  function pintarRejilla() {
    const rejilla = $("#rejilla");
    const frag = document.createDocumentFragment();
    for (const app of datos.apps) {
      const cat = categoria(app);
      const t = document.createElement("article");
      t.className = "tarjeta";
      t.style.setProperty("--c", cat.color);
      t.dataset.cat = app.categoria;
      t.dataset.texto = norm([app.nombre, app.resumen, cat.nombre, ...(app.etiquetas || [])].join(" "));
      const estado = ESTADOS[app.estado] ? `<span class="estado">${ESTADOS[app.estado]}</span>` : "";
      t.innerHTML = `
        <div class="portada">
          ${app.imagen ? `<img src="${esc(app.imagen)}" alt="" loading="lazy" width="900" height="560">`
                       : `<span class="inicial" aria-hidden="true">${esc(app.nombre.slice(0, 1))}</span>`}
          ${estado}
        </div>
        <div class="cuerpo">
          <span class="categoria">${esc(cat.nombre)}</span>
          <h3>${esc(app.nombre)}</h3>
          <p>${esc(app.resumen)}</p>
          <ul class="etiquetas">${(app.etiquetas || []).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
          ${botones(app)}
        </div>`;
      frag.appendChild(t);
    }
    if (datos.mostrar_proxima) {
      const p = document.createElement("div");
      p.className = "proxima";
      p.innerHTML = `<span class="mas" aria-hidden="true">+</span><strong>Próxima app</strong><span>En desarrollo</span>`;
      frag.appendChild(p);
    }
    rejilla.replaceChildren(frag);
  }

  function aplicar() {
    document.querySelectorAll(".filtro").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.cat || null) === filtro)));
    const q = norm(texto).trim();
    let visibles = 0;
    document.querySelectorAll(".tarjeta").forEach((t) => {
      const ok = (!filtro || t.dataset.cat === filtro) && (!q || t.dataset.texto.includes(q));
      t.hidden = !ok;
      if (ok) visibles++;
    });
    const proxima = $(".proxima");
    if (proxima) proxima.hidden = !!(filtro || q);
    $("#vacio").hidden = visibles > 0;
  }

  $("#buscar").addEventListener("input", (e) => {
    texto = e.target.value;
    aplicar();
    if (texto && window.scrollY < 200) $("#apps").scrollIntoView({ behavior: "smooth" });
  });
  $("#anio").textContent = new Date().getFullYear();

  fetch("apps.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((j) => {
      datos = j;
      datos.apps.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
      pintarResumen(); pintarDestacada(); pintarFiltros(); pintarRejilla(); aplicar();
    })
    .catch(() => {
      $("#rejilla").innerHTML = '<p class="vacio">No se pudo cargar la lista de apps. Revisa que apps.json exista y sea JSON válido.</p>';
    });
})();
