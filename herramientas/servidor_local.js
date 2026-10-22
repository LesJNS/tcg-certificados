// Sirve publico/ imitando a Vercel: primero el archivo (con cleanUrls), después los rewrites de vercel.json.
// Uso: node herramientas/servidor_local.js [puerto]
const http = require("http"), fs = require("fs"), path = require("path");
const RAIZ = path.resolve(__dirname, "..", "publico");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf" };
const archivo = (p) => { try { return fs.statSync(p).isFile() ? p : null; } catch { return null; } };
http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const p = path.join(RAIZ, ruta);
  if (!p.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  let f = archivo(p) || archivo(p + ".html") || (ruta.endsWith("/") ? archivo(path.join(p, "index.html")) : null);
  if (!f && /^\/c\/[^/]+$/.test(ruta)) f = path.join(RAIZ, "credencial.html"); // rewrite
  if (!f) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.argv[2]) || 5001, () => console.log("listo"));
