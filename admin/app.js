(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const R = window.TCGRender;

  const S = { config: null, certificados: [], layout: null, base: null, siguiente: "" };

  // ---------- utilidades ----------
  function toast(msg, err) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (err ? " err" : "");
    clearTimeout(toast.h);
    toast.h = setTimeout(() => (t.className = "toast"), err ? 6000 : 2500);
  }

  async function api(ruta, cuerpo) {
    const r = await fetch(ruta, cuerpo === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
    return j;
  }

  const cargarImg = (src) => new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error("No se pudo cargar " + src));
    i.src = src;
  });

  const aBlobPng = (canvas) => new Promise((ok) => canvas.toBlob(ok, "image/png"));
  const blobADataUrl = (b) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });

  function pdfDe(canvasOImgs, w, h, formato) {
    // w,h en mm: tamaño real de la diapositiva original (33,867 x 19,05 cm)
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [w, h], compress: true });
    canvasOImgs.forEach((c, i) => {
      if (i) doc.addPage([w, h], "landscape");
      if (formato === "JPEG") doc.addImage(c.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, w, h, undefined, "FAST");
      else doc.addImage(c, "PNG", 0, 0, w, h, undefined, "FAST");
    });
    return doc;
  }
  const pdfBase64 = (doc) => {
    const buf = new Uint8Array(doc.output("arraybuffer"));
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  };

  function datosForm() {
    return {
      codigo: $("f-codigo").value.trim().toUpperCase(),
      nombre: $("f-nombre").value,
      capacitacion: $("f-capacitacion").value,
      fechas: $("f-fechas").value,
      frase: $("f-frase").value,
      area: $("f-area").value,
    };
  }

  // ---------- vista previa ----------
  const CANVAS_OCULTO = document.createElement("canvas");
  let pendiente = false;

  function dibujar(canvas, datos) {
    return R.dibujarCertificado(canvas, S.base, S.layout, {
      nombre: datos.nombre || "NOMBRE DEL PARTICIPANTE",
      capacitacion: datos.capacitacion || "TÍTULO DE LA CAPACITACIÓN",
      fechas: datos.fechas || "Texto de fechas.",
      frase: datos.frase || S.config.fraseIntroPorDefecto,
      codigo: datos.codigo,
    }, S.config.baseUrl);
  }

  function actualizarPreview() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      const d = datosForm();
      const info = dibujar($("canvas"), d);
      $("url-qr").textContent = d.codigo ? `QR → ${S.config.baseUrl}/c/${d.codigo}` : "";
      $("info-preview").textContent = info.escala < 1 ? "El texto se redujo automáticamente para que quepa." : "";
      const existe = S.certificados.some((c) => c.codigo === d.codigo);
      setAviso(existe ? `El código ${d.codigo} ya existe: generar lo sobrescribirá.` : "", existe ? "err" : "");
    });
  }

  function setAviso(msg, clase) { const a = $("aviso"); a.textContent = msg; a.className = "aviso " + (clase || ""); }

  // ---------- generar ----------
  async function emitir(datos, sobrescribir) {
    const canvas = CANVAS_OCULTO;
    dibujar(canvas, datos);
    const png = await blobADataUrl(await aBlobPng(canvas));
    const [w, h] = S.layout.diapositiva_cm.map((x) => x * 10);
    const pdf = pdfBase64(pdfDe([canvas], w, h));
    // vista ligera (JPG 1600 px) para la página pública y la tarjeta al compartir
    const mini = document.createElement("canvas");
    mini.width = 1600; mini.height = Math.round(1600 * canvas.height / canvas.width);
    const mctx = mini.getContext("2d");
    mctx.imageSmoothingQuality = "high";
    mctx.drawImage(canvas, 0, 0, mini.width, mini.height);
    const jpg = mini.toDataURL("image/jpeg", 0.88);
    return api("/api/emitir", { registro: datos, png, jpg, pdf, sobrescribir: !!sobrescribir });
  }

  async function recargar() {
    const e = await api("/api/estado");
    S.config = e.config; S.certificados = e.certificados; S.siguiente = e.siguienteCodigo;
    $("n-emitidos").textContent = `(${S.certificados.length})`;
    $("c-base").value = S.config.baseUrl;
    renderLista();
  }

  async function onGenerar(ev) {
    ev.preventDefault();
    const d = datosForm();
    const existe = S.certificados.some((c) => c.codigo === d.codigo);
    if (existe && !confirm(`El código ${d.codigo} ya existe. ¿Sobrescribir ese certificado?`)) return;
    const b = $("b-generar");
    b.disabled = true; b.textContent = "Generando…";
    try {
      const r = await emitir(d, existe);
      await recargar();
      toast(`Certificado ${r.registro.codigo} generado`);
      setAviso(`Generado: publico/certs/${d.codigo}.png y .pdf`, "ok");
      $("f-codigo").value = S.siguiente;
      ["f-nombre", "f-area"].forEach((i) => ($(i).value = ""));
      $("f-nombre").focus();
      actualizarPreview();
    } catch (e) { setAviso(e.message, "err"); toast(e.message, true); }
    finally { b.disabled = false; b.textContent = "Generar certificado"; }
  }

  // ---------- lista de emitidos ----------
  function renderLista() {
    const q = $("buscar").value.trim().toLowerCase();
    const tb = $("tbody");
    tb.innerHTML = "";
    const filas = S.certificados.filter((c) =>
      !q || [c.codigo, c.nombre, c.capacitacion, c.area].join(" ").toLowerCase().includes(q));
    for (const c of filas) {
      const tr = document.createElement("tr");
      const celda = (t) => { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); return td; };
      celda(c.codigo); celda(c.nombre); celda(c.area || "—"); celda(c.fecha_emision);
      const tdE = celda(""); const sp = document.createElement("span");
      sp.className = "badge " + c.estado; sp.textContent = c.estado; tdE.appendChild(sp);
      const acc = celda(""); acc.className = "acc";
      const enlace = (txt, href) => { const a = document.createElement("a"); a.textContent = txt; a.href = href; a.target = "_blank"; a.rel = "noopener"; acc.appendChild(a); };
      enlace("PNG", `/publico/${c.imagen}`); enlace("PDF", `/publico/${c.pdf}`);
      enlace("Página", `${S.config.baseUrl}/c/${c.codigo}`);
      const btn = document.createElement("button");
      btn.className = "mini " + (c.estado === "vigente" ? "danger" : "");
      btn.textContent = c.estado === "vigente" ? "Revocar" : "Reactivar";
      btn.onclick = () => cambiarEstado(c);
      acc.appendChild(btn);
      tb.appendChild(tr);
    }
    $("vacio").hidden = filas.length > 0;
  }

  async function cambiarEstado(c) {
    const nuevo = c.estado === "vigente" ? "revocado" : "vigente";
    if (!confirm(`¿Marcar ${c.codigo} (${c.nombre}) como ${nuevo}?`)) return;
    try { await api("/api/estado-cert", { codigo: c.codigo, estado: nuevo }); await recargar(); toast(`${c.codigo}: ${nuevo}`); }
    catch (e) { toast(e.message, true); }
  }

  async function pdfImpresion() {
    const vig = S.certificados.filter((c) => c.estado === "vigente");
    if (!vig.length) return toast("No hay certificados vigentes", true);
    const b = $("b-impresion"); b.disabled = true;
    try {
      const [w, h] = S.layout.diapositiva_cm.map((x) => x * 10);
      const cvs = [];
      for (const c of vig) {
        b.textContent = `Preparando ${cvs.length + 1}/${vig.length}…`;
        const cv = document.createElement("canvas");
        dibujar(cv, c);
        cvs.push(cv);
      }
      const r = await api("/api/impresion", { pdf: pdfBase64(pdfDe(cvs, w, h, "JPEG")) });
      toast(`PDF guardado en ${r.ruta}`);
    } catch (e) { toast(e.message, true); }
    finally { b.disabled = false; b.textContent = "PDF de impresión (vigentes)"; }
  }

  // ---------- importación masiva ----------
  let filasCsv = [];

  function parseCsv(texto) {
    texto = texto.replace(/^﻿/, "");
    const primera = texto.split(/\r?\n/, 1)[0];
    const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ";" : ",";
    const filas = []; let f = [], c = "", q = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (q) {
        if (ch === '"' && texto[i + 1] === '"') { c += '"'; i++; }
        else if (ch === '"') q = false;
        else c += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { f.push(c); c = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && texto[i + 1] === "\n") i++;
        f.push(c); c = ""; if (f.some((x) => x.trim())) filas.push(f); f = [];
      } else c += ch;
    }
    f.push(c); if (f.some((x) => x.trim())) filas.push(f);
    return filas;
  }

  const norm = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function cargarCsv(texto) {
    const filas = parseCsv(texto);
    if (filas.length < 2) throw new Error("El CSV no tiene filas de datos");
    const cab = filas[0].map(norm);
    const idx = (n) => cab.indexOf(n);
    const col = { nombre: idx("nombre"), capacitacion: idx("capacitacion"), fechas: idx("fechas"), area: idx("area") };
    if (col.nombre < 0 || col.capacitacion < 0 || col.fechas < 0) throw new Error("Faltan columnas: se requieren nombre, capacitacion y fechas (area es opcional)");
    const m = S.siguiente.match(/^(.*-)(\d+)$/);
    if (!m) throw new Error("No se pudo calcular el siguiente código");
    const pref = m[1];
    let n = parseInt(m[2], 10);
    filasCsv = filas.slice(1).map((r) => ({
      codigo: pref + String(n++).padStart(3, "0"),
      nombre: (r[col.nombre] || "").trim(),
      capacitacion: (r[col.capacitacion] || "").trim(),
      fechas: (r[col.fechas] || "").trim(),
      area: col.area >= 0 ? (r[col.area] || "").trim() : "",
      resultado: "",
    }));
    renderMasivo();
  }

  function renderMasivo() {
    const tb = $("m-tbody"); tb.innerHTML = "";
    filasCsv.forEach((f, i) => {
      const tr = document.createElement("tr");
      [i + 1, f.codigo, f.nombre, f.capacitacion, f.fechas, f.area, f.resultado].forEach((v) => {
        const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    const invalidas = filasCsv.filter((f) => !f.nombre || !f.capacitacion || !f.fechas).length;
    $("m-info").textContent = filasCsv.length
      ? `${filasCsv.length} filas${invalidas ? ` · ${invalidas} con datos incompletos (se omitirán)` : ""}`
      : "";
    $("b-masivo").disabled = !filasCsv.length || invalidas === filasCsv.length;
  }

  async function generarMasivo() {
    const b = $("b-masivo"); b.disabled = true;
    let ok = 0;
    for (const f of filasCsv) {
      if (!f.nombre || !f.capacitacion || !f.fechas) { f.resultado = "Omitido (datos incompletos)"; continue; }
      try {
        await emitir({ ...f, frase: $("m-frase").value || S.config.fraseIntroPorDefecto }, false);
        f.resultado = "✔ Generado"; ok++;
      } catch (e) { f.resultado = "✖ " + e.message; }
      renderMasivo();
    }
    await recargar();
    toast(`${ok} de ${filasCsv.length} certificados generados`, ok < filasCsv.length);
  }

  // ---------- ajustes ----------
  async function guardarBase() {
    try {
      const r = await api("/api/config", { baseUrl: $("c-base").value.trim() });
      S.config = r.config; $("c-base").value = S.config.baseUrl;
      toast("BASE_URL guardada"); actualizarPreview();
    } catch (e) { toast(e.message, true); }
  }

  async function regenerarTodos() {
    if (!S.certificados.length) return;
    if (!confirm(`Se regenerarán ${S.certificados.length} certificados (PNG, PDF y página) con la BASE_URL:\n${S.config.baseUrl}`)) return;
    const b = $("b-regenerar"); b.disabled = true;
    let n = 0;
    try {
      for (const c of S.certificados.slice()) {
        $("c-info").textContent = `Regenerando ${++n}/${S.certificados.length}: ${c.codigo}`;
        await emitir(c, true);
      }
      await recargar();
      $("c-info").textContent = `Listo: ${n} certificados regenerados con ${S.config.baseUrl}`;
      toast("Certificados regenerados");
    } catch (e) { $("c-info").textContent = e.message; toast(e.message, true); }
    finally { b.disabled = false; }
  }

  // ---------- arranque ----------
  async function init() {
    [S.layout, S.base] = await Promise.all([
      fetch("/plantilla/layout.json").then((r) => r.json()),
      cargarImg("/plantilla/certificado_base.png"),
    ]);
    await recargar();
    $("f-frase").value = S.config.fraseIntroPorDefecto;
    $("m-frase").value = S.config.fraseIntroPorDefecto;
    $("f-codigo").value = S.siguiente;

    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + t.dataset.tab));
    }));
    ["f-nombre", "f-capacitacion", "f-fechas", "f-frase", "f-area", "f-codigo"].forEach((i) => $(i).addEventListener("input", actualizarPreview));
    $("form").addEventListener("submit", onGenerar);
    $("b-sugerir").addEventListener("click", () => { $("f-codigo").value = S.siguiente; actualizarPreview(); });
    $("buscar").addEventListener("input", renderLista);
    $("b-impresion").addEventListener("click", pdfImpresion);
    $("csv-file").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { cargarCsv(await f.text()); } catch (err) { filasCsv = []; renderMasivo(); toast(err.message, true); }
    });
    $("b-masivo").addEventListener("click", generarMasivo);
    $("b-plantilla-csv").addEventListener("click", () => {
      const csv = "nombre,capacitacion,fechas,area\n\"Nombre Apellido Uno\",\"TÍTULO DE LA CAPACITACIÓN\",\"Realizadas los días 5 y 20 de octubre de 2026.\",TI\n";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
      a.download = "ejemplo_certificados.csv"; a.click();
    });
    $("b-base").addEventListener("click", guardarBase);
    $("b-regenerar").addEventListener("click", regenerarTodos);
    actualizarPreview();
  }

  init().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:20px;color:#c0392b">Error al iniciar: ${e.message}. ¿Existe plantilla/certificado_base.png?</p>`); });
})();
