#!/usr/bin/env python3
"""
Actualiza la base de conocimiento del bot a partir del Compendio de Normas SBS.

Fuente: https://www.sbs.gob.pe/app/pp/INT_CN/Paginas/Busqueda/BusquedaCompendio.aspx

Pasos:
  1. Selecciona el sistema (por defecto SF - Sistema Financiero) en el compendio.
  2. Recorre todos los temas y recoge las normas asociadas (número, sumilla, fecha, normaId).
  3. Abre la ficha de cada norma (estado, versión, fechas, enlace al PDF).
  4. Descarga el PDF (con caché), extrae el texto y lo divide en fragmentos por artículo.
  5. Escribe data/catalogo.json, data/fragmentos.json y data/meta.json.

Uso:
  pip install -r scripts/requirements.txt
  python scripts/actualizar_normativa.py                 # SF completo
  python scripts/actualizar_normativa.py --sistemas SF COOPAC
  python scripts/actualizar_normativa.py --solo-catalogo # sin descargar PDFs
  python scripts/actualizar_normativa.py --incluir-no-vigentes
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://www.sbs.gob.pe/app/pp/INT_CN/Paginas/Busqueda/"
URL_COMPENDIO = BASE + "BusquedaCompendio.aspx"
URL_DETALLE = BASE + "BusquedaPortal.aspx?normaId={id}"

# Valor e índice de cada sistema en el combo "Sistema/Compendio" (verificado en la web de la SBS).
SISTEMAS = {
    "SF": (1, "SF - Sistema Financiero"),
    "SS": (2, "SS - Sistema de Seguros"),
    "SPP": (3, "SPP - Sistema Privado de Pensiones"),
    "LA/FT_SBS": (4, "LA/FT_SBS - Sujetos Obligados supervisados por la SBS"),
    "LA/FT_superv": (5, "LA/FT_superv - Organismos supervisores de sujetos obligados"),
    "COOPAC": (6, "COOPAC - Cooperativas de Ahorro y Crédito"),
    "AFOCAT": (7, "AFOCAT"),
    "Otros": (8, "Otros"),
    "LA/FT_grles": (9, "LA/FT_grles - Normas Generales"),
    "LA/FT_UIF": (10, "LA/FT_UIF - Sujetos Obligados supervisados por la UIF"),
    "LA/FT_otros": (11, "LA/FT_otros - Sujetos Obligados supervisados por otros supervisores"),
}
COMBO = "ctl00$ContentPlaceHolder1$rcbCompendio"
COMBO_STATE = "ctl00_ContentPlaceHolder1_rcbCompendio_ClientState"

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
CACHE = RAIZ / ".cache_pdfs"

MAX_BYTES_ARCHIVO = 20_000_000  # ~20 MB por archivo de fragmentos
TAM_FRAGMENTO = 1800   # caracteres aprox. por fragmento
SOLAPE = 200

sesion = requests.Session()
sesion.headers.update({
    "User-Agent": "Mozilla/5.0 (NormaBot SBS; actualizacion del compendio)",
    "Accept-Language": "es-PE,es;q=0.9",
})


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def pedir(metodo: str, url: str, reintentos: int = 4, **kw) -> requests.Response:
    for i in range(reintentos):
        try:
            r = sesion.request(metodo, url, timeout=60, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            espera = 3 * (i + 1)
            log(f"  ! {e} — reintento en {espera}s")
            time.sleep(espera)
    raise RuntimeError(f"No se pudo acceder a {url}")


def ocultos(soup: BeautifulSoup) -> dict:
    return {i.get("name"): i.get("value", "") for i in soup.select("input[type=hidden]") if i.get("name")}


def limpiar(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


# ---------------------------------------------------------------- 1-2. Catálogo
def normas_de_sistema(clave: str) -> dict[str, dict]:
    indice, texto = SISTEMAS[clave]
    soup = BeautifulSoup(pedir("GET", URL_COMPENDIO).text, "lxml")

    datos = ocultos(soup)
    datos.update({
        "__EVENTTARGET": COMBO,
        "__EVENTARGUMENT": json.dumps({"Command": "Select", "Index": indice}),
        COMBO: texto,
        COMBO_STATE: json.dumps({"logEntries": [], "value": clave, "text": texto, "enabled": True,
                                  "checkedIndices": [], "checkedItemsTextOverflows": False}),
    })
    soup = BeautifulSoup(pedir("POST", URL_COMPENDIO, data=datos).text, "lxml")
    temas = [(a["id"], limpiar(a.get_text())) for a in soup.select("a[id*=LinkButtonTemas]")]
    log(f"[{clave}] {len(temas)} temas")
    base = ocultos(soup)

    normas: dict[str, dict] = {}
    for n, (id_html, tema) in enumerate(temas, 1):
        datos = dict(base)
        datos.update({"__EVENTTARGET": id_html.replace("_", "$"), "__EVENTARGUMENT": "", COMBO: texto})
        s = BeautifulSoup(pedir("POST", URL_COMPENDIO, data=datos).text, "lxml")
        cuenta = 0
        for a in s.select("a[href*='normaId=']"):
            m = re.search(r"normaId=(\d+)", a["href"])
            tr = a.find_parent("tr")
            if not m or tr is None:
                continue
            celdas = [limpiar(td.get_text()) for td in tr.find_all("td", recursive=False)]
            nid = m.group(1)
            reg = normas.setdefault(nid, {
                "id": nid,
                "norma": celdas[0] if celdas else limpiar(a.get_text()),
                "sumilla": celdas[1] if len(celdas) > 1 else "",
                "fecha_emision": celdas[2] if len(celdas) > 2 else "",
                "sistemas_compendio": [],
                "temas": [],
            })
            if tema not in reg["temas"]:
                reg["temas"].append(tema)
            if clave not in reg["sistemas_compendio"]:
                reg["sistemas_compendio"].append(clave)
            cuenta += 1
        log(f"  {n:3}/{len(temas)} {tema}: {cuenta}")
        time.sleep(0.3)
    return normas


# ---------------------------------------------------------------- 3. Ficha
def ficha(norma: dict) -> None:
    url = URL_DETALLE.format(id=norma["id"])
    soup = BeautifulSoup(pedir("GET", url).text, "lxml")
    filas = [tr for tr in soup.find_all("tr")
             if len(tr.find_all("td", recursive=False)) == 14
             and limpiar(tr.find_all("td", recursive=False)[1].get_text())]
    if not filas:
        norma["estado"] = "Desconocido"
        return
    fila = next((f for f in filas if limpiar(f.find_all("td", recursive=False)[1].get_text()) == norma["norma"]),
                filas[0])
    td = fila.find_all("td", recursive=False)
    c = [limpiar(x.get_text()) for x in td]
    norma.update({
        "norma": c[1] or norma["norma"],
        "version": c[2],
        "sumilla": c[3] or norma["sumilla"],
        "tipo": c[4],
        "estado": c[5],
        "sistemas": c[6],
        "fecha_publicacion": c[7],
        "fecha_emision": c[8] or norma.get("fecha_emision", ""),
    })
    a_pdf = td[10].find("a", href=True)
    norma["_pdf"] = urljoin(url, a_pdf["href"]) if a_pdf else None


# ---------------------------------------------------------------- 4. PDF → texto
def texto_pdf(norma: dict) -> str:
    if not norma.get("_pdf"):
        return ""
    CACHE.mkdir(exist_ok=True)
    version = re.sub(r"[^\w.]", "", norma.get("version", "v"))
    archivo_txt = CACHE / f"{norma['id']}_{version}.txt"
    if archivo_txt.exists():
        return archivo_txt.read_text(encoding="utf-8")

    r = pedir("GET", norma["_pdf"])
    if not r.content.startswith(b"%PDF"):
        log(f"  ! {norma['norma']}: la descarga no es un PDF ({r.headers.get('content-type')})")
        return ""
    from pypdf import PdfReader
    try:
        lector = PdfReader(io.BytesIO(r.content))
        paginas = [(p.extract_text() or "") for p in lector.pages]
    except Exception as e:  # PDF dañado o escaneado
        log(f"  ! {norma['norma']}: no se pudo leer el PDF ({e})")
        return ""
    texto = "\n".join(paginas)
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto).strip()
    archivo_txt.write_text(texto, encoding="utf-8")
    return texto


PATRON_ART = re.compile(
    r"(?im)^\s*(art[íi]culo\s+\d+[°º]?(?:\s*-?\s*[A-Z])?\.?|"
    r"(?:primera|segunda|tercera|cuarta|quinta|sexta|s[ée]ptima|octava|novena|d[ée]cima)\.?\s*-|"
    r"disposici[oó]n(?:es)?\s+(?:complementaria|final|transitoria)[^\n]{0,40}|anexo\s+[\wN°º-]+)"
)


def fragmentar(texto: str) -> list[tuple[str, str]]:
    """Divide el texto en (etiqueta, contenido), intentando respetar los artículos."""
    if not texto:
        return []
    def etiqueta(m):  # primera línea de la sección, p. ej. "Artículo 5°.- Clasificación del deudor"
        fin = texto.find("\n", m.end())
        return limpiar(texto[m.start(): fin if fin != -1 else m.end() + 80])[:80]
    cortes = [(m.start(), etiqueta(m)) for m in PATRON_ART.finditer(texto)]
    secciones: list[tuple[str, str]] = []
    if not cortes or cortes[0][0] > 0:
        cortes.insert(0, (0, "Considerandos / encabezado"))
    for i, (ini, etiqueta) in enumerate(cortes):
        fin = cortes[i + 1][0] if i + 1 < len(cortes) else len(texto)
        secciones.append((etiqueta, texto[ini:fin].strip()))

    # Une secciones muy cortas y parte las muy largas
    res: list[tuple[str, str]] = []
    buf_et, buf = "", ""
    for et, sec in secciones:
        if len(buf) + len(sec) < TAM_FRAGMENTO:
            buf_et = buf_et or et
            buf = (buf + "\n" + sec).strip()
            continue
        if buf:
            res.append((buf_et, buf))
        buf_et, buf = et, sec
        while len(buf) > TAM_FRAGMENTO * 1.5:
            corte = buf.rfind(". ", 0, TAM_FRAGMENTO) + 1 or TAM_FRAGMENTO
            res.append((buf_et, buf[:corte].strip()))
            buf = buf[max(0, corte - SOLAPE):]
    if buf:
        res.append((buf_et, buf))
    return [(et, limpiar(t)) for et, t in res if len(t) > 80]


# ---------------------------------------------------------------- main
def es_vigente(n: dict) -> bool:
    # "Modificada" = norma en vigor que ha sido modificada por otra posterior
    e = unicodedata.normalize("NFKD", n.get("estado", "")).lower()
    return e.startswith("vigente") or e.startswith("modificada")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sistemas", nargs="+", default=["SF"], choices=list(SISTEMAS))
    ap.add_argument("--solo-catalogo", action="store_true", help="No descarga PDFs")
    ap.add_argument("--incluir-no-vigentes", action="store_true", help="Indexa también el texto de normas no vigentes")
    ap.add_argument("--limite", type=int, default=0, help="Procesar solo N normas (pruebas)")
    args = ap.parse_args()

    DATA.mkdir(exist_ok=True)
    catalogo: dict[str, dict] = {}
    for s in args.sistemas:
        for nid, n in normas_de_sistema(s).items():
            if nid in catalogo:
                for k in ("temas", "sistemas_compendio"):
                    catalogo[nid][k] = sorted(set(catalogo[nid][k]) | set(n[k]))
            else:
                catalogo[nid] = n
    ids = list(catalogo)[: args.limite or None]
    log(f"Total normas únicas: {len(catalogo)}")
    if len(catalogo) < 20:
        sys.exit("ERROR: el Compendio devolvió muy pocas normas (¿cambió la web de la SBS?). No se modificó la data.")

    fragmentos = []
    for i, nid in enumerate(ids, 1):
        n = catalogo[nid]
        try:
            ficha(n)
        except Exception as e:
            log(f"  ! ficha {nid}: {e}")
            continue
        log(f"[{i}/{len(ids)}] {n['norma']} — {n.get('estado')}")
        if args.solo_catalogo or not (args.incluir_no_vigentes or es_vigente(n)):
            continue
        try:
            txt = texto_pdf(n)
        except Exception as e:
            log(f"  ! pdf {nid}: {e}")
            txt = ""
        n["paginas_indexadas"] = bool(txt)
        for j, (et, t) in enumerate(fragmentar(txt)):
            fragmentos.append({"id": f"{nid}-{j}", "n": nid, "s": et, "t": t})
        time.sleep(0.2)

    for n in catalogo.values():
        n.pop("_pdf", None)

    # Control de calidad: no se reemplaza la data buena por una descarga fallida
    if not args.solo_catalogo:
        candidatas = [n for n in catalogo.values() if "paginas_indexadas" in n]
        con_texto = sum(1 for n in candidatas if n["paginas_indexadas"])
        log(f"Normas con texto extraído: {con_texto}/{len(candidatas)}")
        if candidatas and con_texto < 0.5 * len(candidatas):
            sys.exit("ERROR: menos de la mitad de los PDFs pudo leerse. No se modificó la data.")

    def clave_fecha(n):
        d = n.get("fecha_emision", "")
        return d[6:10] + d[3:5] + d[0:2]

    lista = sorted(catalogo.values(), key=clave_fecha, reverse=True)
    (DATA / "catalogo.json").write_text(json.dumps(lista, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    archivos = []
    if not args.solo_catalogo:
        # Se parte en varios archivos para no superar los límites de tamaño de GitHub
        for viejo in DATA.glob("fragmentos*.json"):
            viejo.unlink()
        lote, tam, k = [], 0, 0
        for f in fragmentos + [None]:
            if f is None or (tam > MAX_BYTES_ARCHIVO and lote):
                if lote or not archivos:
                    nombre = f"fragmentos-{k:03}.json"
                    (DATA / nombre).write_text(json.dumps(lote, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                    archivos.append(nombre)
                    k += 1
                lote, tam = [], 0
                if f is None:
                    break
            lote.append(f)
            tam += len(f["t"].encode("utf-8")) + 60
    ahora_lima = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5)))
    meta = {
        "actualizado": ahora_lima.isoformat(timespec="minutes"),
        "fecha_corte": ahora_lima.strftime("%d/%m/%Y"),
        "sistemas": args.sistemas,
        "normas": len(catalogo),
        "normas_con_texto": sum(1 for n in catalogo.values() if n.get("paginas_indexadas")),
        "fragmentos": len(fragmentos) if not args.solo_catalogo else None,
        "archivos_fragmentos": archivos,
        "fuente": URL_COMPENDIO,
    }
    prev = DATA / "meta.json"
    if args.solo_catalogo and prev.exists():
        anterior = json.loads(prev.read_text(encoding="utf-8"))
        meta["fragmentos"] = anterior.get("fragmentos")
        meta["archivos_fragmentos"] = anterior.get("archivos_fragmentos", [])
        meta["normas_con_texto"] = anterior.get("normas_con_texto", 0)
        meta["fecha_texto"] = anterior.get("fecha_texto")  # fecha del último texto completo
    else:
        meta["fecha_texto"] = meta["fecha_corte"]
    prev.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
