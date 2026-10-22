# Certificados TCG con verificación por QR

Sistema de emisión (panel local) y verificación (sitio estático para Vercel) de certificados de
Towers Consulting Group (TCG).

```
plantilla/   diseño base: certificado_base.png (3200x1800), layout.json (texto, estilos y QR), crear_base.py
admin/       panel de administración local (HTML/JS puros + server.js sin dependencias)
publico/     sitio público (estático): se despliega en Vercel
config.json  BASE_URL, emisor, firmantes, prefijo de código
salida/      PDF único de impresión (todos los vigentes)
herramientas/ scripts de verificación y automatización (Python, opcionales)
```

## a) Emitir certificados nuevos

Requisitos: Node 18+ (nada más; no hay `npm install`).

```
node admin/server.js
```

Abre <http://localhost:3000>. El servidor solo escucha en `127.0.0.1`.

- **Emitir**: completa nombre, título de la capacitación, fechas, frase introductoria (ya viene con el
  valor por defecto) y, opcionalmente, área. El código `TCG-CI-AAAA-NNN` se sugiere solo y se puede
  editar. La vista previa se actualiza en vivo; si el nombre o el título son largos, el texto se
  ajusta solo (reduce el tamaño y salta de línea). **Generar certificado** crea:
  `publico/certs/{CODIGO}.png` (alta resolución), `.pdf`, `.jpg` (vista ligera), `publico/c/{CODIGO}.html`
  (página con metadatos Open Graph) y agrega el registro a `publico/data/certificados.json`.
- **Emitidos**: lista con búsqueda; botón **Revocar / Reactivar** (cambia `estado` en el JSON) y
  **PDF de impresión** (un PDF con todos los vigentes en `salida/`).
- **Importación masiva**: CSV con columnas `nombre, capacitacion, fechas, area` (coma o punto y coma,
  UTF-8). Hay un CSV de ejemplo descargable en el propio panel.

Después de emitir, sube los cambios de `publico/` (ver b).

Todo lo fijo (fondo, medallón, logo, firmas de Juan Carlos Torres Napa y Ángela Carpio Zamudio) está en
`plantilla/certificado_base.png`. Si cambia el diseño, edita la diapositiva 2 de
`Ejemplos de certificados.pptx` y ejecuta `python plantilla/crear_base.py` (usa LibreOffice si está
instalado; si no, PowerPoint en Windows). Posiciones y estilos: `plantilla/layout.json`.

## b) Desplegar `publico/` en Vercel

1. Crea un proyecto en Vercel apuntando a este repositorio/carpeta con **Root Directory = `publico`**
   (Framework Preset: *Other*; sin comando de build ni carpeta de salida).
   Sin Git: `cd publico && npx vercel --prod`.
2. `publico/vercel.json` ya incluye el rewrite `/c/:codigo` → `credencial.html` y `cleanUrls`.
3. Cada vez que emitas o revoques, vuelve a desplegar (push a Git o `npx vercel --prod`).

Rutas: `/` (buscador de código), `/c/TCG-CI-2026-001` (credencial: sello, imagen, datos, descargas y
copiar enlace). Solo el código va en la URL.

Probar en local: `cd publico && npx serve .` (usa `serve.json`, equivalente a `vercel.json`).

## c) Cambiar BASE_URL y regenerar los certificados

El QR contiene `{BASE_URL}/c/{CODIGO}` y queda impreso en la imagen, así que al cambiar de dirección
hay que volver a generarlos:

1. Panel → **Ajustes** → escribe la nueva BASE_URL → **Guardar** (o edita `baseUrl` en `config.json`).
2. **Regenerar todos los certificados con la BASE_URL actual**: rehace PNG, PDF, JPG y páginas de todos
   los registros (conserva código, fecha de emisión y estado).
3. Vuelve a generar el PDF de impresión (**Emitidos → PDF de impresión**) y despliega.

Mientras no haya dominio definitivo se usa `https://tcg-certificados.vercel.app`. Los QR ya impresos
con una dirección anterior solo seguirán funcionando mientras esa dirección siga activa.

## Notas

- `publico/data/certificados.json` es público (el sitio lo lee): contiene nombre, área y capacitación de
  cada persona certificada. Si el área no debe ser pública, quítala del JSON antes de desplegar.
- Los códigos son correlativos y predecibles; la verificación confirma que el certificado existe,
  no es un secreto.
- Verificación automatizada (Python + Playwright/OpenCV, opcional): `herramientas/verificar_qr.py`
  decodifica cada QR (PNG, PDF y PDF de impresión) y `herramientas/probar_sitio.py` prueba el sitio.
