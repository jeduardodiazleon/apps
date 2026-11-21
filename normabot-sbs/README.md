# NormaBot SBS

Chatbot gratuito para consultar la normativa SBS del sistema financiero peruano. Funciona como página estática en **GitHub Pages** y cada respuesta indica la **Resolución SBS** (o circular u oficio) en la que se basa, con enlace a su ficha oficial en el Compendio de Normas de la SBS.

## Cómo funciona

1. **Búsqueda local**: el navegador busca en la normativa indexada (`data/`) los fragmentos más relevantes para la consulta.
2. **IA con reglas**: esos fragmentos y las reglas de `config/reglas.md` se envían a Gemini (Google, nivel gratuito), que redacta la respuesta citando `[F1]`, `[F2]`…
3. **Citas verificables**: el bot convierte esas marcas en enlaces a la ficha de cada norma y añade siempre una lista de **Fuentes** (norma, sumilla, estado y fecha de emisión).

Si no hay IA configurada, el bot funciona en **modo búsqueda**: muestra las normas y los extractos más relevantes, también con su fuente.

## Estructura

| Archivo | Para qué sirve |
|---|---|
| `config/reglas.md` | **Reglas del bot** (citar siempre la resolución, vigencia, estilo, límites…). Edítalo libremente. |
| `config/config.json` | Ajustes: textos de la interfaz, ejemplos, modelo de IA, cuántos fragmentos usar, URL del Worker. |
| `data/catalogo.json` | Catálogo de normas (número, sumilla, estado, fecha, temas, id de la SBS). |
| `data/fragmentos-*.json` | Texto completo de las normas dividido por artículos (lo genera el script). |
| `scripts/actualizar_normativa.py` | Descarga el Compendio SBS, los PDFs y regenera `data/`. |
| `../.github/workflows/normabot-sbs-actualizar.yml` | Botón en GitHub Actions para actualizar la data cuando quieras. |
| `worker/worker.js` | Pequeño servidor gratuito (Cloudflare) que guarda en secreto tu clave de Gemini. |

## Puesta en marcha

### 1. Publicación
El bot vive en la carpeta `normabot-sbs/` del repositorio `apps` y se publica en
`https://jeduardodiazleon.github.io/apps/normabot-sbs/`. El bot ya funciona en modo búsqueda.

### 2. Actualizar la normativa (cuando tú decidas)
El sitio **no hace scraping solo**: la data queda guardada en `data/` y solo se renueva cuando el dueño lo pide. No hace falta computadora, se hace desde GitHub (también desde la app del celular):

1. En tu repositorio, entra a la pestaña **Actions**. La primera vez, si GitHub lo pide, pulsa **"I understand my workflows, go ahead and enable them"**.
2. Elige **NormaBot SBS: actualizar normativa** → botón **Run workflow**.
3. Escoge el modo y pulsa el botón verde **Run workflow**:
   - **completo**: catálogo + texto de los PDFs (la primera vez tarda 1–3 horas; las siguientes, minutos, porque reutiliza los PDFs ya procesados).
   - **solo catálogo**: rápido, actualiza la lista de normas y su estado sin descargar PDFs.
4. Al terminar, la acción publica la nueva data y GitHub Pages se actualiza solo en uno o dos minutos.

Cada respuesta del bot muestra **"Normativa SBS actualizada al dd/mm/aaaa"** con la fecha (hora de Lima) de la última actualización. El texto se cambia en `config/config.json` → `citas.texto_fecha_datos`.

Protecciones: si la web de la SBS no responde, devuelve muy pocas normas o falla la lectura de más de la mitad de los PDFs, la acción se detiene con error y **no reemplaza** la data anterior.

> La primera actualización **completa** es la que le da al bot el contenido de cada norma: el repositorio trae un catálogo inicial (432 resoluciones vigentes del Sistema Financiero, con número, sumilla, estado, fecha y temas) pero sin el texto de los PDFs.

### 3. Activar la IA gratis (Gemini + Cloudflare Worker)
1. Crea una clave gratuita en [Google AI Studio](https://aistudio.google.com/apikey).
2. Crea una cuenta gratuita en [Cloudflare](https://dash.cloudflare.com) → **Workers & Pages → Create → Worker**, pega el contenido de `worker/worker.js` y despliega.
3. En el Worker → **Settings → Variables and Secrets**:
   - `GEMINI_API_KEY` (tipo *Secret*): tu clave.
   - `ALLOWED_ORIGINS`: `https://jeduardodiazleon.github.io`
4. Copia la URL del Worker (`https://xxxx.workers.dev`) en `config/config.json` → `ia.worker_url`.

Así la clave nunca queda expuesta en la página. **Alternativa rápida para pruebas**: botón ⚙ del bot → pega tu clave de Gemini (se guarda solo en tu navegador).

> Nivel gratuito de Gemini: tiene límites de consultas por minuto y por día, y Google puede usar los datos del nivel gratuito para mejorar sus productos. No envíes información confidencial.

## Mejorar el bot sin tocar código
- **Reglas** → `config/reglas.md` (por ejemplo: formato de citas, extensión, tono, qué hacer si no hay información).
- **Bienvenida, ejemplos, aviso legal** → `config/config.json` → `interfaz`.
- **Precisión de la búsqueda** → `config/config.json` → `busqueda` (`fragmentos_por_consulta`, `puntaje_minimo`, `priorizar_vigentes`).
- **Modelo de IA** → `ia.modelo` (por defecto `gemini-flash-latest`, que apunta siempre al Flash más reciente; usa `gemini-flash-lite-latest` si quieres más consultas gratis).

## Probar en local
```bash
python -m http.server 8000   # y abre http://localhost:8000
```

## Aviso
Herramienta informativa. No sustituye la lectura del texto oficial ni constituye asesoría legal. Fuente de datos: [Compendio de Normas SBS](https://www.sbs.gob.pe/app/pp/INT_CN/Paginas/Busqueda/BusquedaCompendio.aspx).
