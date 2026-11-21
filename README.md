# Apps de J. Eduardo Díaz León

Portada y apps publicadas en **https://jeduardodiazleon.github.io/apps/**.

La portada muestra cada app como un elemento de una "tabla periódica". El color indica la familia (finanzas, IA, datos…) y el número, el orden de creación.

## Estructura

```
apps/
├── index.html              ← portada
├── apps.json               ← registro de apps (lo único que editas para añadir una)
├── assets/                 ← estilos, script y tipografías de la portada
├── normabot-sbs/           ← app 1: NormaBot SBS
├── .github/workflows/      ← acciones (p. ej. actualizar la normativa de NormaBot)
└── .nojekyll
```

Cada app vive en **su propia carpeta** con todo lo que necesita, así que una app no afecta a otra.

## Publicar en GitHub Pages
1. Sube todo el contenido de esta carpeta a la raíz del repositorio `apps`.
2. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
3. En un par de minutos estará en `https://jeduardodiazleon.github.io/apps/`.

## Añadir una nueva app
1. Crea su carpeta, por ejemplo `mi-nueva-app/`, con su `index.html`.
2. Añade un bloque en `apps.json` → `apps`:

```json
{
  "numero": 2,
  "simbolo": "Ca",
  "nombre": "Calculadora de cuotas",
  "resumen": "Calcula el cronograma de pagos de un préstamo.",
  "descripcion": "Texto más largo que aparece al abrir la ficha de la app.",
  "familia": "finanzas",
  "etiquetas": ["Créditos", "Calculadora"],
  "estado": "beta",
  "ruta": "mi-nueva-app/",
  "codigo": "https://github.com/jeduardodiazleon/apps/tree/main/mi-nueva-app",
  "fecha": "2026-12"
}
```

- `simbolo`: una o dos letras, como un elemento químico.
- `familia`: una de las claves de `familias` (`finanzas`, `ia`, `datos`, `productividad`, `herramientas`). Puedes crear nuevas familias con su nombre y color.
- `estado`: `activa`, `beta` o `en_desarrollo`.
- `espacios_proximos`: cuántas casillas vacías de "Próximamente" se muestran después de la última app.

Una familia aparece en los filtros cuando tiene al menos una app.

## Apps
| # | App | Carpeta |
|---|---|---|
| 1 | NormaBot SBS: consultas de normativa SBS con cita de la resolución | [`normabot-sbs/`](normabot-sbs/) |
