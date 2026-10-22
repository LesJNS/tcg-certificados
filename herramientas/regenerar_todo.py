"""Regenera todos los certificados con la BASE_URL actual desde el panel (servidor en marcha)
y deja el PDF de impresión en salida/. Equivale a Ajustes > Regenerar + 'PDF de impresión'."""
import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge")
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    pg.on("pageerror", lambda e: print("pageerror:", e))
    pg.on("dialog", lambda d: d.accept())
    pg.goto("http://localhost:3000")
    pg.wait_for_selector("#canvas")
    pg.click('[data-tab="ajustes"]')
    pg.click("#b-regenerar")
    pg.wait_for_function("/Listo|Error|ya existe|HTTP/.test(document.getElementById('c-info').textContent)", timeout=400000)
    print(pg.inner_text("#c-info"))
    pg.click('[data-tab="emitidos"]')
    pg.evaluate("document.getElementById('b-impresion').click()")
    pg.wait_for_function("/PDF guardado|Error|No hay/.test(document.getElementById('toast').textContent)", timeout=400000)
    print(pg.inner_text("#toast"))
    b.close()
