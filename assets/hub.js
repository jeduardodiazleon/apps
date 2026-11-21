/* Portada de apps: lee apps.json y dibuja la tabla. Para añadir apps edita solo apps.json. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const ESTADOS = { activa: "", beta: "Beta", en_desarrollo: "En desarrollo" };
  const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mesAnio = (f) => {
    if (!f) return "";
    const [a, m] = f.split("-");
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    return m ? `${meses[+m - 1]} de ${a}` : a;
  };

  let datos, filtro = null;

  function pintarLeyenda() {
    const leyenda = $("#leyenda");
    const boton = (clave, nombre, color, n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "filtro";
      b.dataset.familia = clave ?? "";
      b.setAttribute("aria-pressed", String(filtro === clave));
      if (color) b.style.setProperty("--c", color);
      b.innerHTML = (color ? '<span class="muestra" aria-hidden="true"></span>' : "") +
        `${escapar(nombre)} <span class="cuantas">${n}</span>`;
      b.addEventListener("click", () => { filtro = filtro === clave ? null : clave; aplicarFiltro(); });
      return b;
    };
    leyenda.replaceChildren(boton(null, "Todas", null, datos.apps.length));
    for (const [clave, f] of Object.entries(datos.familias)) {
      const n = datos.apps.filter((a) => a.familia === clave).length;
      if (!n) continue; // las familias aparecen en la leyenda cuando tienen al menos una app
      leyenda.appendChild(boton(clave, f.nombre, f.color, n));
    }
  }

  function pintarTabla() {
    const tabla = $("#tabla");
    const apps = [...datos.apps].sort((a, b) => a.numero - b.numero);
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const app of apps) {
      const fam = datos.familias[app.familia] || { nombre: "", color: "#F5F6FF" };
      const el = document.createElement("button");
      el.type = "button";
      el.className = "elemento";
      el.dataset.familia = app.familia;
      el.style.setProperty("--c", fam.color);
      el.style.setProperty("--i", i++);
      el.setAttribute("aria-label", `${app.nombre}. ${app.resumen}`);
      const estado = ESTADOS[app.estado] ? `<span class="estado">${ESTADOS[app.estado]}</span>` : "";
      el.innerHTML = `
        <span class="fila"><span class="num">${app.numero}</span>${estado}</span>
        <span class="sim">${escapar(app.simbolo)}</span>
        <span><span class="nombre">${escapar(app.nombre)}</span><span class="fam">${escapar(fam.nombre)}</span></span>`;
      el.addEventListener("click", () => abrirFicha(app, fam));
      frag.appendChild(el);
    }
    const ultimo = apps.length ? apps[apps.length - 1].numero : 0;
    for (let k = 1; k <= (datos.espacios_proximos || 0); k++) {
      const v = document.createElement("div");
      v.className = "vacante";
      v.style.setProperty("--i", i++);
      v.setAttribute("aria-hidden", "true");
      v.innerHTML = `<span class="num">${ultimo + k}</span><span class="sim">?</span><span class="nombre">Próximamente</span>`;
      frag.appendChild(v);
    }
    tabla.replaceChildren(frag);
    tabla.classList.add("entrando");
    setTimeout(() => tabla.classList.remove("entrando"), 1600);
  }

  function aplicarFiltro() {
    document.querySelectorAll(".filtro").forEach((b) =>
      b.setAttribute("aria-pressed", String((b.dataset.familia || null) === filtro)));
    let visibles = 0;
    document.querySelectorAll(".elemento").forEach((el) => {
      const ok = !filtro || el.dataset.familia === filtro;
      el.classList.toggle("oculto", !ok);
      if (ok) visibles++;
    });
    document.querySelectorAll(".vacante").forEach((v) => v.classList.toggle("oculto", !!filtro));
    const fam = filtro ? datos.familias[filtro].nombre : null;
    $("#conteo").textContent = fam
      ? (visibles ? `${visibles} ${visibles === 1 ? "app" : "apps"} en ${fam}` : `Aún no hay apps en ${fam}`)
      : `${visibles} ${visibles === 1 ? "app publicada" : "apps publicadas"}`;
  }

  function abrirFicha(app, fam) {
    const d = $("#ficha");
    d.querySelector(".ficha-elemento").style.setProperty("--c", fam.color);
    $("#ficha-numero").textContent = app.numero;
    $("#ficha-simbolo").textContent = app.simbolo;
    $("#ficha-familia").textContent = fam.nombre;
    $("#ficha-nombre").textContent = app.nombre;
    $("#ficha-descripcion").textContent = app.descripcion || app.resumen;
    $("#ficha-etiquetas").innerHTML = (app.etiquetas || []).map((t) => `<li>${escapar(t)}</li>`).join("");
    const abrir = $("#ficha-abrir");
    abrir.href = app.ruta;
    abrir.textContent = `Abrir ${app.nombre}`;
    const codigo = $("#ficha-codigo");
    codigo.hidden = !app.codigo;
    if (app.codigo) codigo.href = app.codigo;
    const estado = ESTADOS[app.estado];
    $("#ficha-meta").textContent = [app.fecha ? `Publicada en ${mesAnio(app.fecha)}` : "", estado].filter(Boolean).join(". ");
    d.showModal();
    abrir.focus();
  }

  $("#ficha .cerrar").addEventListener("click", () => $("#ficha").close());
  $("#ficha").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  fetch("apps.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((j) => { datos = j; pintarLeyenda(); pintarTabla(); aplicarFiltro(); })
    .catch(() => {
      $("#tabla").innerHTML = '<p class="conteo">No se pudo cargar la lista de apps (apps.json). Revisa que el archivo exista y sea JSON válido.</p>';
    });
})();
