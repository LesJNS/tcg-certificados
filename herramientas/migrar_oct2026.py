"""Emite los 11 certificados de octubre 2026 usando la importación masiva del panel
(con el servidor `node admin/server.js` en marcha) y genera el PDF de impresión."""
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge")
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    pg.on("pageerror", lambda e: print("pageerror:", e))
    pg.on("dialog", lambda d: d.accept())
    pg.goto("http://localhost:3000")
    pg.wait_for_selector("#canvas")
    pg.click('[data-tab="masivo"]')
    pg.set_input_files("#csv-file", str(RAIZ / "migracion" / "participantes_oct2026.csv"))
    pg.wait_for_function("document.querySelectorAll('#m-tbody tr').length === 11")
    pg.click("#b-masivo")
    pg.wait_for_function("[...document.querySelectorAll('#m-tbody tr')].every(r => /Generado|✖|Omitido/.test(r.lastChild.textContent))", timeout=240000)
    for tr in pg.query_selector_all("#m-tbody tr"):
        print(tr.inner_text().replace("\t", " | "))
    pg.click('[data-tab="emitidos"]')
    pg.click("#b-impresion")
    pg.wait_for_function("/PDF guardado|Error|No hay/.test(document.getElementById('toast').textContent)", timeout=240000)
    print(pg.inner_text("#toast"))
    b.close()
