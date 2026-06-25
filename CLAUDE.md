# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static multi-page site for **Loekemeyer SRL** (Argentine kitchen-utensil wholesaler). There is no build step, no package.json, no test harness — files are served as-is by IIS from this `wwwroot` directory. All JS runs in the browser and talks directly to Supabase.

`web.config` handles: HTTPS redirect, gzip compression (static + dynamic), 1-year client cache for static assets, MIME types for `.webp`/`.woff2`/`.avif`, and security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`). When adding new asset types or tightening CSP/security, edit this file.

## Backend (Supabase)

- Project URL `https://kwkclwhmoygunqmlegrg.supabase.co`, anon key is embedded in every JS file that creates a client. The key is re-declared at the top of `script.js`, `admin.js`, `historial.js`, and `sugerencias.js` — if rotated, it must be updated in all four places.
- Auth uses email/password with a synthetic email scheme `<cuit-digits>@cuit.loekemeyer` and a 6-digit PIN as the password. New auth users are created in `admin.js → createAuthUser` using a second Supabase client that has `persistSession: false` so the admin's own session is not overwritten.
- Admin role is gated by presence of the user's `auth_user_id` in the `admins` table; every admin page redirects to `mayorista.html` if that check fails.
- Key tables/views referenced from the frontend: `customers`, `customer_delivery_addresses`, `admins`, `user_customer_links`, `products`, `loke_products`, `item_groups`, `orders`, `order_items`, `order_tracking`, `app_settings`, `v_customer_item_month`.
- Key RPCs: `submit_order_fast` (order submission), `get_my_assortment_18m`, `get_my_linked_customers`, `has_loke_access`, `get_customer_sales_history`, `sugerencias_cliente`, `novedades_marca`.
- Two Supabase Edge Functions are called via `fetch` (not the SDK): `sheets-proxy` and `sheets-entregas-proxy` at `https://kwkclwhmoygunqmlegrg.functions.supabase.co/...` — these push confirmed orders to Google Sheets. `orders.sheets_payload` / `orders.sheets_sent` are written back after a successful push.
- Product images are served via Supabase public storage: `{SUPABASE_URL}/storage/v1/object/public/products-images/{cod}.webp`. The `BASE_IMG`/`IMG_PARAMS` pair is redeclared in `script.js`, `historial.js`, `sugerencias.js` and `admin.js`; keep them in sync. **Do not use** `/storage/v1/render/image/public/` — the image-transformations feature is disabled on this Supabase tenant (returns 403 "FeatureNotEnabled"). Photos are stored pre-rendered at 400x400 WebP, so `IMG_PARAMS` is an empty string.
- `app_settings.web_order_discount` is read at load time as the web-order discount (fallback `0.02`).

## Pages and their scripts

| Page | Script | Role |
|---|---|---|
| `index.html` | `script.index.js` + `css/styles.index.css` | Public landing, video hero, client-logo bouncing carousel, legal modals. No Supabase. |
| `mayorista.html` | `script.js` + `css/styles.css` | Main B2B SPA-ish catalog: login, product browsing, cart, order submission, Loke line, profile, order history link. Single file containing every "section" (`productos`, `carrito`, `perfil`, `loke`, `pedidoConfirmado`, …) — `showSection(id)` in `script.js` toggles `.active` on `.section` nodes. |
| `historial.html` | `historial.js` + `css/historial.css` | Customer-facing past-orders view. |
| `sugerencias.html` | `sugerencias.js` + `css/sugerencias.css` | Suggestions / new-product tabs per customer (uses `sugerencias_cliente` / `novedades_marca` RPCs). |
| `admin.html` | `admin.js` + `css/admin.css` | Admin panel with sidebar nav (`data-page` attributes on `.nav-item`, hash-based deep-linking via `location.hash`). Handles customers, addresses, products, tracking, promos, and the "Carga/Promo Pedidos" tool (cotizador upload + flyer generator). Depends on the `xlsx` CDN for spreadsheet import/export. |

## Client-side state conventions (`script.js`)

- `script.js` is a 4700-line IIFE-less global-namespace file. Functions are exposed to inline `onclick=` handlers via `window.showSection = showSection` etc. (see bottom of the file around line 4020). When adding a new handler used from HTML, remember to re-export on `window`.
- Global state lives as top-level `let`s: `products`, `cart`, `customerProfile`, `isAdmin`, `deliveryChoice`, `sortMode`, `lastConfirmedOrder`, etc. There is no framework — render functions read these globals and write the DOM directly.
- Anomaly detection: `ANOMALY_THRESHOLD = 6` flags cart lines > 6× a customer's historical monthly average (from view `v_customer_item_month`), cached per-customer in `_anomalyCache`.
- A single customer code is treated as special: `cod_cliente === "5000"` triggers list-price-only mode alongside admins (`isListPriceOnlyClient()`).
- Category ordering is hardcoded: `CATEGORY_ORDER` and `UTENSILIOS_SUB_ORDER` at the top of `script.js`. New categories are ignored in the menu until added here.

## Common operations

- **Run locally**: open `index.html` or `mayorista.html` in a browser, or serve the `wwwroot` directory with any static server (e.g. `python -m http.server`). There is no dev server.
- **Deploy**: the files are the deliverable — copy `wwwroot/` contents to the IIS web root. `loeke.zip` in the repo is a legacy deployment bundle; don't edit.
- **Third-party libs** are loaded from CDN in the HTML files (Supabase JS v2, jsPDF, lottie-web, xlsx). There is no bundler; add new libs the same way (a `<script src="https://cdn...">` tag).
- **SQL fix scripts** like `fix_missing.sql` are one-shot data repairs run manually in the Supabase SQL editor; they are not migrations and have no framework.

## SEO / crawling

- `robots.txt` explicitly allow-lists the major AI/search crawlers (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, bingbot, CCBot, etc.) and declares the sitemap. Generic `User-agent: *` is also allowed; only `/logs/`, `/backup/`, `/tmp/` are disallowed.
- `sitemap.xml` lists only the two public entry points: `/` (landing) and `/mayorista.html` (login gate). The auth-gated pages (`historial.html`, `sugerencias.html`, `admin.html`) must NOT be added — their content lives behind Supabase auth and is not crawlable anyway.
- When adding a new public page, update both `sitemap.xml` (with `<lastmod>`) and — if it should appear in nav — the relevant HTML.

## File locks (edición concurrente)

Varias personas y sesiones de Claude editan este proyecto sobre el mismo share de red. Antes de cualquier `Edit`, `Write` o `NotebookEdit`, Claude DEBE seguir este protocolo. Esto es obligatorio, no opcional.

**Estado compartido:** un solo archivo JSON en `.locks/active.json`:

```json
{
  "locks": [
    { "file": "script.js", "owner": "user@mail@HOSTNAME", "acquired": "2026-04-24T15:30:00Z", "note": "filtro categoría" }
  ]
}
```

**Protocolo antes de editar el archivo `F`:**

1. **Leer** `.locks/active.json`. Si no existe, crearlo con `{"locks": []}`.
2. **Chequear** si `F` ya está listado:
   - Lock propio (mismo `owner`) → continuar sin duplicar la entrada.
   - Lock ajeno con `acquired` dentro de los últimos **60 minutos** → DETENERSE. Avisar al usuario: "`F` está bloqueado por `<owner>` desde hace X min. ¿Esperar, coordinar, o forzar el unlock?" y esperar respuesta.
   - Lock ajeno con `acquired` > 60 min (stale) → avisar al usuario que se rompe el lock viejo y continuar.
   - Sin lock → continuar.
3. **Adquirir:** agregar `{ file, owner, acquired: <ISO now>, note: <motivo corto> }` y escribir el JSON.
4. **Editar** `F`.
5. **Liberar:** al cerrar el turno (tarea completada, o cuando el usuario indica que terminó), quitar las entradas propias y escribir el JSON.

**Owner:** `<email de la sesión>@<COMPUTERNAME>` — obtener el hostname con `$env:COMPUTERNAME` vía PowerShell si aún no se sabe, y reutilizarlo en toda la sesión.

**No se lockean:** `.locks/active.json` mismo, ni archivos que solo se leen.

**Escrituras concurrentes al JSON:** SMB no da locking atómico fuerte. Si al releer antes de escribir el contenido cambió respecto a lo leído, rehacer el paso 2 (otro proceso modificó el archivo en el ínterin).

## Gotchas

- Language is Spanish throughout UI text, variable names, and comments — match the surrounding style when editing.
- The same Supabase URL/anon key/image helper block is duplicated across files by design (no module system). When changing any of these constants, grep for them everywhere.
- `admin.js` uses `var` / function-scoped old-style JS, `script.js` / `historial.js` / `sugerencias.js` use `const`/`let`/arrow functions. Don't "modernize" `admin.js` opportunistically — it's consistent within its file.
- Paths in HTML use a mix of `./css/...` and `css/...` — both resolve the same way under IIS; no need to normalize unless fixing a real bug.
