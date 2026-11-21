# Apps de J. Eduardo Díaz León

Portada y apps publicadas en **https://jeduardodiazleon.github.io/apps/**.

La portada muestra una app destacada en grande y debajo el catálogo completo, con buscador y filtros por categoría.

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
1. Crea su carpeta, por ejemplo `mi-nueva-app/`, con su `index.html` (y si quieres una imagen de portada).
2. Añade un bloque en `apps.json` → `apps`:

```json
{
  "orden": 2,
  "nombre": "Calculadora de cuotas",
  "resumen": "Calcula el cronograma de pagos de un préstamo.",
  "categoria": "finanzas",
  "etiquetas": ["Créditos", "Calculadora"],
  "estado": "beta",
  "destacada": false,
  "imagen": "mi-nueva-app/portada.webp",
  "ruta": "mi-nueva-app/",
  "codigo": "https://github.com/jeduardodiazleon/apps/tree/main/mi-nueva-app"
}
```

- `categoria`: una de las claves de `categorias` (`finanzas`, `ia`, `datos`, `productividad`, `herramientas`). Puedes crear más, cada una con su nombre y color.
- `estado`: `activa`, `beta` o `en_desarrollo`.
- `destacada`: `true` para mostrarla en grande arriba (solo una). Si ninguna lo está, se destaca la última.
- `imagen`: opcional; sin imagen la tarjeta muestra la inicial de la app.
- `mostrar_proxima`: muestra u oculta la tarjeta "Próxima app".

Las categorías aparecen en los filtros cuando tienen al menos una app.

## Apps
| # | App | Carpeta |
|---|---|---|
| 1 | NormaBot SBS: consultas de normativa SBS con cita de la resolución | [`normabot-sbs/`](normabot-sbs/) |
