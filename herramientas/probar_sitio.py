"""Pruebas del sitio público contra un servidor local (por defecto http://localhost:5000)
y del panel (http://localhost:3000, solo para revocar/reactivar durante la prueba)."""
import json
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
SITIO = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PANEL = "http://localhost:3000"
SALIDA = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".")
CODIGO_REVOCADO = "TCG-CI-2026-011"
fallos = []


def check(nombre, cond, extra=""):
    print(("OK    " if cond else "FALLA ") + nombre + (f"  [{extra}]" if extra else ""))
    if not cond:
        fallos.append(nombre)


def panel(ruta, cuerpo):
    req = urllib.request.Request(PANEL + ruta, data=json.dumps(cuerpo).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge")
    movil = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    pg = movil.new_page()
    errores = []
    pg.on("pageerror", lambda e: errores.append(str(e)))

    # --- válido
    pg.goto(f"{SITIO}/c/TCG-CI-2026-002")
    pg.wait_for_selector("#content:not([hidden])")
    check("válido: sello 'Certificado verificado'", pg.inner_text("#status-title") == "Certificado verificado")
    check("válido: nombre", pg.inner_text("#d-nombre") == "Ricardo Adrian Francisco Rodriguez Gomez")
    check("válido: capacitación", "MODELO DE CALIFICACIÓN INTERNA" in pg.inner_text("#d-capacitacion"))
    check("válido: fechas", pg.inner_text("#d-fechas") == "Realizadas los días 5 y 20 de octubre de 2026", pg.inner_text("#d-fechas"))
    check("válido: emisor", pg.inner_text("#d-emisor") == "Towers Consulting Group (TCG)")
    check("válido: código y emisión", pg.inner_text("#d-codigo") == "TCG-CI-2026-002" and "octubre de 2026" in pg.inner_text("#d-emision"), pg.inner_text("#d-emision"))
    pg.wait_for_function("document.getElementById('cert-img').complete && document.getElementById('cert-img').naturalWidth > 0")
    check("válido: imagen carga", pg.evaluate("document.getElementById('cert-img').naturalWidth") > 0)
    check("válido: sin scroll horizontal en 390 px", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    check("URL sin nombre del participante", "rodriguez" not in pg.url.lower())
    pg.screenshot(path=str(SALIDA / "sitio_movil_valido.png"), full_page=True)

    # --- descargas
    with pg.expect_download() as d:
        pg.click("#dl-png")
    png = d.value; ruta = SALIDA / "_dl.png"; png.save_as(ruta)
    check("descarga PNG", png.suggested_filename == "TCG-CI-2026-002.png" and ruta.stat().st_size > 1_000_000 and ruta.read_bytes()[:4] == b"\x89PNG", f"{ruta.stat().st_size} bytes")
    with pg.expect_download() as d:
        pg.click("#dl-pdf")
    pdf = d.value; ruta = SALIDA / "_dl.pdf"; pdf.save_as(ruta)
    check("descarga PDF", pdf.suggested_filename == "TCG-CI-2026-002.pdf" and ruta.read_bytes()[:5] == b"%PDF-", f"{ruta.stat().st_size} bytes")
    (SALIDA / "_dl.png").unlink(); (SALIDA / "_dl.pdf").unlink()

    # --- copiar enlace
    movil.grant_permissions(["clipboard-read", "clipboard-write"], origin=SITIO)
    pg.click("#copy")
    pg.wait_for_function("document.getElementById('toast').classList.contains('show')")
    check("copiar enlace", pg.inner_text("#toast") == "Enlace copiado")
    check("enlace copiado = URL actual", pg.evaluate("navigator.clipboard.readText()") == pg.url)

    # --- inexistente
    pg.goto(f"{SITIO}/c/TCG-CI-2026-999")
    pg.wait_for_selector("#notfound:not([hidden])")
    check("inexistente: 'Certificado no encontrado'", pg.inner_text("#status-title") == "Certificado no encontrado")
    check("inexistente: sin detalles ni imagen", pg.is_hidden("#content"))
    pg.screenshot(path=str(SALIDA / "sitio_movil_noencontrado.png"), full_page=True)

    # --- minúsculas
    pg.goto(f"{SITIO}/c/tcg-ci-2026-003")
    pg.wait_for_selector("#content:not([hidden])")
    check("código en minúsculas se resuelve", pg.inner_text("#d-codigo") == "TCG-CI-2026-003")

    # --- revocado (se restaura al final)
    panel("/api/estado-cert", {"codigo": CODIGO_REVOCADO, "estado": "revocado"})
    try:
        pg.goto(f"{SITIO}/c/{CODIGO_REVOCADO}")
        pg.wait_for_selector("#content:not([hidden])")
        check("revocado: sello 'Certificado revocado'", pg.inner_text("#status-title") == "Certificado revocado")
        check("revocado: descargas deshabilitadas", pg.get_attribute("#dl-png", "aria-disabled") == "true" and pg.get_attribute("#dl-pdf", "href") is None)
        pg.screenshot(path=str(SALIDA / "sitio_movil_revocado.png"), full_page=True)
    finally:
        panel("/api/estado-cert", {"codigo": CODIGO_REVOCADO, "estado": "vigente"})
    pg.goto(f"{SITIO}/c/{CODIGO_REVOCADO}")
    pg.wait_for_selector("#content:not([hidden])")
    check("reactivado: vuelve a 'verificado'", pg.inner_text("#status-title") == "Certificado verificado")

    # --- inicio
    pg.goto(SITIO + "/")
    pg.fill("#codigo", "  tcg-ci-2026-005 ")
    pg.click("button[type=submit]")
    pg.wait_for_url("**/c/TCG-CI-2026-005")
    pg.wait_for_selector("#content:not([hidden])")
    check("inicio: buscar código manual", pg.inner_text("#d-nombre") == "Jerson Alejandro Solsol Saavedra")
    pg.goto(SITIO + "/")
    pg.fill("#codigo", "x")
    pg.click("button[type=submit]")
    check("inicio: código inválido muestra error", "código válido" in pg.inner_text("#err"))
    pg.goto(SITIO + "/")
    pg.screenshot(path=str(SALIDA / "sitio_movil_inicio.png"), full_page=True)

    # --- escritorio
    esc = b.new_context(viewport={"width": 1280, "height": 800})
    pd = esc.new_page()
    pd.goto(f"{SITIO}/c/TCG-CI-2026-001")
    pd.wait_for_selector("#content:not([hidden])")
    pd.wait_for_function("document.getElementById('cert-img').naturalWidth > 0")
    pd.screenshot(path=str(SALIDA / "sitio_escritorio_valido.png"))

    check("sin errores de JavaScript", not errores, "; ".join(errores))
    b.close()

print("\nFALLOS:", len(fallos), fallos)
sys.exit(1 if fallos else 0)
