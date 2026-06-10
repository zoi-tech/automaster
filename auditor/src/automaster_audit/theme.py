"""Tema visual compartilhado (Tron / Encom OS) para as saídas HTML.

Fonte Share Tech Mono embutida em base64 (OFL — ver assets/Share_Tech_Mono-OFL.txt).
Exporta head_assets() (<style> com @font-face + CSS) e overlays() (camadas CRT).
"""
from __future__ import annotations

from pathlib import Path

_ASSETS = Path(__file__).parent / "assets"


def _font_data_uri() -> str:
    b64 = (_ASSETS / "share_tech_mono.woff2.b64").read_text(encoding="utf-8").strip().replace("\n", "")
    return f"data:font/woff2;base64,{b64}"


def _font_face() -> str:
    return (
        "@font-face{font-family:'Share Tech Mono';font-style:normal;font-weight:400;"
        f"font-display:swap;src:url({_font_data_uri()}) format('woff2');}}"
    )


# Paleta + componentes. Sem chaves de .format aqui — injetado como valor.
TRON_CSS = """
:root{
  --bg:#03070b; --panel:rgba(8,18,26,.82); --panel2:rgba(5,11,17,.82);
  --line:#0e3b46; --line2:#0a6e7a;
  --cyan:#2ee6ff; --cyan2:#7df0ff; --amber:#ffb24d; --green:#4dffa6;
  --red:#ff4d6d; --yellow:#e8d44d; --teal:#36d6c4;
  --fg:#bfeef5; --mut:#5b8c97;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background-color:var(--bg); color:var(--fg);
  font-family:'Share Tech Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  letter-spacing:.3px; -webkit-font-smoothing:antialiased;
  background-image:
    linear-gradient(rgba(46,230,255,.05) 1px,transparent 1px),
    linear-gradient(90deg,rgba(46,230,255,.05) 1px,transparent 1px);
  background-size:34px 34px;
}
/* camadas CRT */
.crt-vignette,.crt-scan,.crt-scanline{position:fixed;inset:0;pointer-events:none}
.crt-vignette{z-index:9998;background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.7))}
.crt-scan{z-index:9997;background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 2px,rgba(0,0,0,.16) 2px 3px)}
.crt-scanline{z-index:9996;height:140px;
  background:linear-gradient(rgba(46,230,255,0),rgba(46,230,255,.07),rgba(46,230,255,0));
  animation:sweep 7s linear infinite}
@keyframes sweep{from{transform:translateY(-150px)}to{transform:translateY(100vh)}}
@keyframes flicker{0%,100%,93%,95%,97%{opacity:1}94%{opacity:.72}96%{opacity:.86}}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 7px var(--green)}50%{opacity:.35;box-shadow:0 0 2px var(--green)}}
/* moldura HUD com cantos em colchete (8 segmentos) */
.framed{
  border:1px solid var(--line);
  background-image:
    linear-gradient(var(--cyan),var(--cyan)),linear-gradient(var(--cyan),var(--cyan)),
    linear-gradient(var(--cyan),var(--cyan)),linear-gradient(var(--cyan),var(--cyan)),
    linear-gradient(var(--cyan),var(--cyan)),linear-gradient(var(--cyan),var(--cyan)),
    linear-gradient(var(--cyan),var(--cyan)),linear-gradient(var(--cyan),var(--cyan));
  background-repeat:no-repeat;
  background-size:16px 2px,2px 16px,16px 2px,2px 16px,16px 2px,2px 16px,16px 2px,2px 16px;
  background-position:left top,left top,right top,right top,left bottom,left bottom,right bottom,right bottom;
}
.panel{
  position:relative;background:linear-gradient(180deg,var(--panel),var(--panel2));
  border:1px solid var(--line);
  box-shadow:inset 0 0 24px rgba(46,230,255,.05);
  clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px));
}
h1{margin:0;font-size:17px;font-weight:400;text-transform:uppercase;letter-spacing:2px;
  color:var(--cyan);text-shadow:0 0 10px rgba(46,230,255,.55);animation:flicker 6s infinite}
.sub{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:1px}
.dot-online{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);
  animation:pulse 2s infinite;margin-right:5px;vertical-align:middle}
/* cards de status */
.cards{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.card{background:var(--panel);border:1px solid var(--line);padding:8px 16px;min-width:96px;
  clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))}
.card .n{font-size:22px;color:var(--cyan);text-shadow:0 0 8px rgba(46,230,255,.5)}
.card .l{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.card.warn .n{color:var(--amber);text-shadow:0 0 8px rgba(255,178,77,.5)}
/* nav abas */
nav{display:flex;gap:2px;padding:0 24px;border-bottom:1px solid var(--line);
  background:rgba(3,7,11,.9);position:sticky;top:0;z-index:50;backdrop-filter:blur(2px)}
nav button{background:none;border:none;color:var(--mut);padding:12px 18px;cursor:pointer;
  font-family:inherit;font-size:12px;text-transform:uppercase;letter-spacing:1px;
  border-bottom:2px solid transparent}
nav button:hover{color:var(--cyan2)}
nav button.active{color:var(--cyan);border-bottom-color:var(--cyan);text-shadow:0 0 8px rgba(46,230,255,.6)}
/* inputs */
input{font-family:inherit}
#q,#search{width:100%;max-width:380px;padding:8px 11px;background:rgba(3,10,16,.9);
  border:1px solid var(--line2);color:var(--cyan2);text-transform:uppercase;letter-spacing:1px;
  caret-color:var(--cyan);outline:none}
#q::placeholder,#search input::placeholder{color:var(--mut)}
#q:focus,#search:focus-within{border-color:var(--cyan);box-shadow:0 0 12px rgba(46,230,255,.35)}
/* tabelas */
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;padding:7px 11px;vertical-align:top}
th{color:var(--cyan);text-transform:uppercase;letter-spacing:.6px;font-size:11px;cursor:pointer;
  user-select:none;position:sticky;top:49px;background:rgba(3,7,11,.96);
  border-bottom:1px solid var(--line2);text-shadow:0 0 6px rgba(46,230,255,.35)}
th:hover{color:var(--cyan2)}
td{border-bottom:1px solid rgba(14,59,70,.45)}
tr:hover td{background:rgba(46,230,255,.06);box-shadow:inset 2px 0 0 var(--cyan)}
/* pills */
.pill{display:inline-block;padding:1px 8px;margin:1px;border:1px solid;font-size:10px;
  text-transform:uppercase;letter-spacing:.5px;
  clip-path:polygon(0 0,calc(100% - 5px) 0,100% 5px,100% 100%,5px 100%,0 calc(100% - 5px))}
.published{color:var(--green);border-color:var(--green);box-shadow:0 0 6px rgba(77,255,166,.25)}
.draft{color:var(--amber);border-color:var(--amber)}
.chan{color:var(--cyan2);border-color:var(--line2)}
.orphan{color:var(--red);border-color:var(--red);box-shadow:0 0 6px rgba(255,77,109,.3)}
.muted{color:var(--mut)}
.drill{font-size:11px;color:var(--mut);padding-left:4px}
details summary{cursor:pointer;color:var(--cyan);text-transform:uppercase;font-size:11px}
details summary:hover{color:var(--cyan2)}
/* scrollbar */
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:rgba(3,7,11,.6)}
::-webkit-scrollbar-thumb{background:var(--line2);border:1px solid var(--line)}
::-webkit-scrollbar-thumb:hover{background:var(--cyan)}
/* layout do painel */
header{position:relative;margin:10px;padding:18px 22px 16px}
.hud-top{display:flex;align-items:center;gap:6px;margin-bottom:9px}
.wrap{padding:16px 24px}
/* grafo */
#net{width:100%;height:100vh}
#panel{position:fixed;top:14px;left:14px;padding:16px 18px;max-width:270px;font-size:12px;z-index:9990;margin:0}
#panel h1{font-size:14px;margin-bottom:9px}
#filters label{display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer;
  text-transform:uppercase;font-size:11px;letter-spacing:.5px;color:var(--fg)}
#filters .dot{width:10px;height:10px;display:inline-block;box-shadow:0 0 6px currentColor}
#legend-missing{margin-top:11px;font-size:10px;color:var(--red);text-transform:uppercase;letter-spacing:.5px}
#info{margin-top:9px;font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
"""


def head_assets() -> str:
    """Bloco <style> com @font-face (fonte embutida) + tema. Injetar no <head>."""
    return f"<style>{_font_face()}\n{TRON_CSS}</style>"


def overlays() -> str:
    """Camadas CRT (grid já está no body). Injetar logo após <body>."""
    return '<div class="crt-vignette"></div><div class="crt-scan"></div><div class="crt-scanline"></div>'


# paleta para os nós do grafo (vis-network), dentro do espectro Tron
GRAPH_COLORS = {
    "workflow": "#2ee6ff",
    "tag": "#4dffa6",
    "pipeline": "#ffb24d",
    "stage": "#ffd27a",
    "field": "#e8d44d",
    "trigger": "#36d6c4",
    "user": "#c77dff",
}
