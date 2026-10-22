(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  function codigoDeLaUrl() {
    var q = new URLSearchParams(location.search).get("codigo");
    var partes = location.pathname.replace(/\/+$/, "").split("/");
    var raw = q || partes[partes.length - 1] || "";
    if (/^(index|credencial)(\.html)?$/i.test(raw)) raw = "";
    try { raw = decodeURIComponent(raw); } catch (e) { /* se deja tal cual */ }
    return raw.replace(/\.html$/i, "").trim().toUpperCase();
  }

  function estado(clase, icono, titulo, sub) {
    var el = $("status");
    el.className = "status " + clase;
    el.querySelector(".icon").textContent = icono;
    $("status-title").textContent = titulo;
    $("status-sub").textContent = sub || "";
  }

  function fechaLarga(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return iso || "—";
    var meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
      "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    return parseInt(m[3], 10) + " de " + meses[parseInt(m[2], 10) - 1] + " de " + m[1];
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2000);
  }

  function copiar(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (ok, fail) {
      var ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy") ? ok() : fail(); } catch (e) { fail(e); }
      document.body.removeChild(ta);
    });
  }

  function noEncontrado(codigo) {
    estado("missing", "!", "Certificado no encontrado",
      "No se pudo verificar la autenticidad de este código.");
    $("nf-code").textContent = codigo || "(vacío)";
    $("notfound").hidden = false;
    document.title = "Certificado no encontrado · Towers Consulting Group (TCG)";
  }

  function mostrar(c) {
    var revocado = c.estado === "revocado";
    if (revocado) {
      estado("revoked", "×", "Certificado revocado",
        "Este certificado ya no es válido. Comunícate con Towers Consulting Group (TCG) para más información.");
    } else {
      estado("ok", "✓", "Certificado verificado",
        "Este certificado fue emitido por " + c.emisor + ".");
    }
    document.title = (revocado ? "Certificado revocado" : "Certificado verificado") +
      " · " + c.codigo + " · TCG";

    $("d-nombre").textContent = c.nombre;
    $("d-capacitacion").textContent = c.capacitacion;
    $("d-fechas").textContent = String(c.fechas || "").replace(/\.$/, "");
    $("d-emisor").textContent = c.emisor;
    $("d-codigo").textContent = c.codigo;
    $("d-emision").textContent = fechaLarga(c.fecha_emision);
    $("d-firmantes").textContent = (c.firmantes || [])
      .map(function (f) { return f.nombre + " (" + f.cargo + ")"; }).join(" · ");

    var img = $("cert-img");
    img.src = "/" + (c.vista || c.imagen);
    img.alt = "Certificado " + c.codigo + " de " + c.nombre;
    if (revocado) {
      $("cert-frame").classList.add("revoked");
      $("cert-link").removeAttribute("href");
      $("cert-link").removeAttribute("target");
      document.querySelector(".zoom-hint").hidden = true;
    } else {
      $("cert-link").href = "/" + c.imagen;
    }

    var png = $("dl-png"), pdf = $("dl-pdf");
    png.href = "/certs/" + c.codigo + ".png";
    png.setAttribute("download", c.codigo + ".png");
    pdf.href = "/certs/" + c.codigo + ".pdf";
    pdf.setAttribute("download", c.codigo + ".pdf");
    if (revocado) {
      png.setAttribute("aria-disabled", "true");
      pdf.setAttribute("aria-disabled", "true");
      png.removeAttribute("href");
      pdf.removeAttribute("href");
    }

    $("copy").addEventListener("click", function () {
      copiar(location.href).then(
        function () { toast("Enlace copiado"); },
        function () { toast("No se pudo copiar el enlace"); });
    });
    $("content").hidden = false;
  }

  var codigo = codigoDeLaUrl();
  if (!codigo) { noEncontrado(""); return; }

  fetch("/data/certificados.json", { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (lista) {
      try {
        var c = (lista || []).filter(function (x) {
          return String(x.codigo).toUpperCase() === codigo;
        })[0];
        if (c) mostrar(c); else noEncontrado(codigo);
      } catch (e) {
        if (window.console) console.error(e);
        estado("missing", "!", "No se pudo mostrar el certificado",
          "Ocurrió un error al mostrar los datos. Intenta recargar la página.");
      }
    }, function () {
      estado("missing", "!", "No se pudo verificar",
        "Hubo un problema de conexión. Intenta de nuevo en unos minutos.");
    });
})();
