#!/usr/bin/env node
/**
 * Servidor local del panel de administración de certificados TCG.
 * Sin dependencias: solo módulos estándar de Node. Escucha únicamente en localhost.
 *
 *   node admin/server.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const ADMIN = __dirname;
const PLANTILLA = path.join(RAIZ, "plantilla");
const PUBLICO = path.join(RAIZ, "publico");
const CERTS = path.join(PUBLICO, "certs");
const PAGINAS = path.join(PUBLICO, "c");
const DATA = path.join(PUBLICO, "data", "certificados.json");
const SALIDA = path.join(RAIZ, "salida");
const CONFIG = path.join(RAIZ, "config.json");

const RE_CODIGO = /^[A-Z0-9][A-Z0-9-]{2,40}$/;
const MAX_BODY = 60 * 1024 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".pdf": "application/pdf", ".svg": "image/svg+xml",
};

// ---------- utilidades ----------
const leerJson = async (p, def) => {
  try { return JSON.parse(await fsp.readFile(p, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return def; throw e; }
};

async function escribirAtomico(p, contenido) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  await fsp.writeFile(tmp, contenido);
  await fsp.rename(tmp, p);
}

// Cola para que las escrituras sobre el JSON no se pisen entre sí.
let cola = Promise.resolve();
const enCola = (fn) => {
  const r = cola.then(fn, fn);
  cola = r.catch(() => {});
  return r;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const base64 = (s) => Buffer.from(String(s).replace(/^data:[^,]*,/, ""), "base64");

function ordenar(lista) {
  return lista.sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}

function siguienteCodigo(lista, cfg) {
  const anio = new Date().getFullYear();
  const pref = `${cfg.prefijoCodigo}-${anio}-`;
  let max = 0;
  for (const c of lista) {
    if (c.codigo.startsWith(pref)) {
      const n = parseInt(c.codigo.slice(pref.length), 10);
      if (n > max) max = n;
    }
  }
  return pref + String(max + 1).padStart(3, "0");
}

/** Página /c/CODIGO con metadatos Open Graph propios (los rastreadores no ejecutan JS). */
async function paginaCredencial(reg, baseUrl) {
  const plantilla = await fsp.readFile(path.join(PUBLICO, "credencial.html"), "utf8");
  const url = `${baseUrl}/c/${reg.codigo}`;
  const img = `${baseUrl}/certs/${reg.codigo}.jpg`;
  const titulo = `Certificado ${reg.codigo} · ${reg.emisor}`;
  const desc = `Certificado verificable emitido por ${reg.emisor}: ${reg.capacitacion}.`;
  const og = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(reg.emisor)}">`,
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:width" content="1600">`,
    `<meta property="og:image:height" content="900">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
  ].join("\n");
  return plantilla
    .replace(/<!--OG-->[\s\S]*?<!--\/OG-->/, `<!--OG-->\n${og}\n<!--/OG-->`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(titulo)}</title>`);
}

function validarRegistro(r) {
  const err = [];
  if (!r || typeof r !== "object") return ["registro vacío"];
  if (!RE_CODIGO.test(r.codigo || "")) err.push("código inválido");
  for (const k of ["nombre", "capacitacion", "fechas", "frase"]) {
    if (typeof r[k] !== "string" || !r[k].trim()) err.push(`falta ${k}`);
    else if (r[k].length > 400) err.push(`${k} demasiado largo`);
  }
  if (r.area != null && String(r.area).length > 200) err.push("área demasiado larga");
  return err;
}

// ---------- API ----------
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function apiEstado() {
  const cfg = await leerJson(CONFIG, {});
  const certificados = await leerJson(DATA, []);
  return { config: cfg, certificados, siguienteCodigo: siguienteCodigo(certificados, cfg) };
}

async function apiEmitir(body) {
  const cfg = await leerJson(CONFIG, {});
  const r = body.registro;
  const errores = validarRegistro(r);
  if (errores.length) throw new HttpError(400, errores.join(", "));
  if (!/^data:image\/png;base64,/.test(body.png || "")) throw new HttpError(400, "falta la imagen PNG");
  if (!/^data:image\/jpeg;base64,/.test(body.jpg || "")) throw new HttpError(400, "falta la vista JPG");
  if (!body.pdf) throw new HttpError(400, "falta el PDF");

  return enCola(async () => {
    const lista = await leerJson(DATA, []);
    const i = lista.findIndex((c) => c.codigo === r.codigo);
    if (i >= 0 && !body.sobrescribir) throw new HttpError(409, `El código ${r.codigo} ya existe`);

    const previo = i >= 0 ? lista[i] : null;
    const reg = {
      codigo: r.codigo,
      nombre: r.nombre.trim(),
      area: (r.area || "").trim(),
      capacitacion: r.capacitacion.trim(),
      frase: r.frase.trim(),
      fechas: r.fechas.trim(),
      emisor: cfg.emisor,
      firmantes: cfg.firmantes,
      estado: previo ? previo.estado : "vigente",
      fecha_emision: previo ? previo.fecha_emision : new Date().toISOString().slice(0, 10),
      imagen: `certs/${r.codigo}.png`,
      vista: `certs/${r.codigo}.jpg`,
      pdf: `certs/${r.codigo}.pdf`,
    };
    await escribirAtomico(path.join(CERTS, `${r.codigo}.png`), base64(body.png));
    await escribirAtomico(path.join(CERTS, `${r.codigo}.jpg`), base64(body.jpg));
    await escribirAtomico(path.join(CERTS, `${r.codigo}.pdf`), base64(body.pdf));
    await escribirAtomico(path.join(PAGINAS, `${r.codigo}.html`), await paginaCredencial(reg, cfg.baseUrl));
    if (i >= 0) lista[i] = reg; else lista.push(reg);
    await escribirAtomico(DATA, JSON.stringify(ordenar(lista), null, 2) + "\n");
    return { ok: true, registro: reg };
  });
}

async function apiEstadoCert({ codigo, estado }) {
  if (!["vigente", "revocado"].includes(estado)) throw new HttpError(400, "estado inválido");
  return enCola(async () => {
    const lista = await leerJson(DATA, []);
    const c = lista.find((x) => x.codigo === codigo);
    if (!c) throw new HttpError(404, "no existe");
    c.estado = estado;
    if (estado === "revocado") c.fecha_revocacion = new Date().toISOString().slice(0, 10);
    else delete c.fecha_revocacion;
    await escribirAtomico(DATA, JSON.stringify(lista, null, 2) + "\n");
    return { ok: true, registro: c };
  });
}

async function apiConfig({ baseUrl }) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new HttpError(400, "URL inválida"); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, "la URL debe ser http(s)");
  const cfg = await leerJson(CONFIG, {});
  cfg.baseUrl = u.origin + u.pathname.replace(/\/+$/, "");
  await escribirAtomico(CONFIG, JSON.stringify(cfg, null, 2) + "\n");
  return { ok: true, config: cfg };
}

async function apiImpresion(body) {
  await escribirAtomico(path.join(SALIDA, "Certificados_TCG_impresion.pdf"), base64(body.pdf));
  return { ok: true, ruta: "salida/Certificados_TCG_impresion.pdf" };
}

const RUTAS_API = {
  "POST /api/emitir": apiEmitir,
  "POST /api/estado-cert": apiEstadoCert,
  "POST /api/config": apiConfig,
  "POST /api/impresion": apiImpresion,
  "GET /api/estado": apiEstado,
};

// ---------- estáticos ----------
async function estatico(res, raiz, rel) {
  const p = path.resolve(raiz, "." + path.sep + rel);
  if (p !== raiz && !p.startsWith(raiz + path.sep)) throw new HttpError(403, "prohibido");
  let st;
  try { st = await fsp.stat(p); } catch { throw new HttpError(404, "no encontrado"); }
  const f = st.isDirectory() ? path.join(p, "index.html") : p;
  let data;
  try { data = await fsp.readFile(f); } catch { throw new HttpError(404, "no encontrado"); }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function leerCuerpo(req) {
  return new Promise((ok, fail) => {
    const partes = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > MAX_BODY) { fail(new HttpError(413, "cuerpo demasiado grande")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => {
      try { ok(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")); }
      catch { fail(new HttpError(400, "JSON inválido")); }
    });
    req.on("error", fail);
  });
}

const servidor = http.createServer(async (req, res) => {
  const json = (status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  try {
    // Defensa contra DNS rebinding / peticiones de otros orígenes.
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new HttpError(403, "host no permitido");
    if (req.method === "POST") {
      const origen = req.headers.origin;
      if (origen && new URL(origen).host !== req.headers.host) throw new HttpError(403, "origen no permitido");
      if (!/^application\/json/.test(req.headers["content-type"] || "")) throw new HttpError(415, "se espera JSON");
    }

    const url = new URL(req.url, "http://localhost");
    const ruta = decodeURIComponent(url.pathname);

    if (ruta.startsWith("/api/")) {
      const h = RUTAS_API[`${req.method} ${ruta}`];
      if (!h) throw new HttpError(404, "ruta API desconocida");
      const body = req.method === "POST" ? await leerCuerpo(req) : undefined;
      return json(200, await h(body));
    }
    if (req.method !== "GET") throw new HttpError(405, "método no permitido");
    if (ruta.startsWith("/plantilla/")) return await estatico(res, PLANTILLA, ruta.slice(11));
    if (ruta.startsWith("/publico/")) return await estatico(res, PUBLICO, ruta.slice(9));
    return await estatico(res, ADMIN, ruta.replace(/^\/+/, "") || "index.html");
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    json(e.status || 500, { ok: false, error: e.status ? e.message : "error interno" });
  }
});

/** Reescribe publico/c/*.html con la plantilla actual: evita páginas desactualizadas si cambia credencial.html. */
async function regenerarPaginas(cfg) {
  const lista = await leerJson(DATA, []);
  for (const reg of lista) {
    await escribirAtomico(path.join(PAGINAS, `${reg.codigo}.html`), await paginaCredencial(reg, cfg.baseUrl));
  }
  return lista.length;
}

(async () => {
  const cfg = await leerJson(CONFIG, {});
  console.log(`Páginas de credencial actualizadas: ${await regenerarPaginas(cfg)}`);
  const host = "127.0.0.1"; // solo localhost, a propósito
  const puerto = Number(process.env.PORT) || (cfg.servidor && cfg.servidor.puerto) || 3000;
  servidor.listen(puerto, host, () => {
    console.log(`Panel de administración TCG: http://localhost:${puerto}`);
    console.log(`BASE_URL actual: ${cfg.baseUrl}`);
  });
})();
