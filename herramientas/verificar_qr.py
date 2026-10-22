"""Decodifica el QR de cada certificado (PNG, PDF individual y PDF de impresión)
y comprueba que devuelve {baseUrl}/c/{codigo}."""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pymupdf

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
cfg = json.loads((RAIZ / "config.json").read_text(encoding="utf-8"))
regs = json.loads((RAIZ / "publico/data/certificados.json").read_text(encoding="utf-8"))
det_aruco = cv2.QRCodeDetectorAruco()
det_clasico = cv2.QRCodeDetector()


def leer(img):
    # El detector clásico a veces no localiza el QR en imágenes grandes aunque sea válido;
    # el basado en Aruco es más robusto, y se usa el clásico como respaldo.
    txt, _, _ = det_aruco.detectAndDecode(img)
    return txt or det_clasico.detectAndDecode(img)[0]


def pagina_a_img(page, ancho=2400):
    z = ancho / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    return cv2.cvtColor(a, cv2.COLOR_RGB2BGR)


fallos = 0
imp = pymupdf.open(RAIZ / "salida/Certificados_TCG_impresion.pdf")
vigentes = [r for r in regs if r["estado"] == "vigente"]
assert imp.page_count == len(vigentes), (imp.page_count, len(vigentes))
for r in regs:
    esperado = f"{cfg['baseUrl']}/c/{r['codigo']}"
    fuentes = {
        "PNG": cv2.imread(str(RAIZ / "publico" / r["imagen"])),
        "JPG": cv2.imread(str(RAIZ / "publico" / r["vista"])),
        "PDF": pagina_a_img(pymupdf.open(RAIZ / "publico" / r["pdf"])[0]),
    }
    if r in vigentes:
        fuentes["PDF-impresión"] = pagina_a_img(imp[vigentes.index(r)])
    res = []
    for nombre, img in fuentes.items():
        ok = leer(img) == esperado
        fallos += not ok
        res.append(f"{nombre}:{'OK' if ok else 'FALLA'}")
    print(r["codigo"], esperado, " ".join(res))
print("FALLOS:", fallos)
sys.exit(1 if fallos else 0)
