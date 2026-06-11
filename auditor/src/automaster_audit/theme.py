"""Tema visual compartilhado "Sala de Controle" (IBM Carbon) para as saídas HTML.

Fontes embutidas em base64 a partir de assets/ (licenças OFL ao lado dos .b64):
IBM Plex Sans variável (UI) + IBM Plex Mono (números, ids, labels técnicos).

Exporta:
- head_assets()  -> <style> com @font-face + CSS completo do design system
- overlays()     -> "" (mantido por compatibilidade de template)
- topbar(loc, extracted, schema=None) -> shell compartilhado: barra escura 48px
- sidebar(active, counts=None)  -> shell compartilhado: navegação 256px que
  unifica dashboard.html / graph.html / validation.html (links relativos)
- shell_meta(dump_dir) -> contadores + schemaVersion lidos do dump ao lado do
  HTML (só leitura; tolerante a falha) para sidebar/topbar das 3 páginas
- GRAPH_COLORS   -> paleta do grafo: ink p/ workflows, azuis/teals p/ entidades

Acento azul #0f62fe só em link/ativo/foco. Severidade só em status
(#da1e28 / #f1c21b / #24a148). #da1e28 e #f1c21b ficam FORA de GRAPH_COLORS:
são reservados para referência quebrada (MISSING) e aresta em ciclo no grafo.
"""
from __future__ import annotations

import html as _html
import json
from pathlib import Path

_ASSETS = Path(__file__).parent / "assets"


def _font_data_uri(asset: str) -> str:
    b64 = (_ASSETS / asset).read_text(encoding="utf-8").strip().replace("\n", "")
    return f"data:font/woff2;base64,{b64}"


def _font_faces() -> str:
    sans = _font_data_uri("ibm_plex_sans.woff2.b64")
    mono = _font_data_uri("ibm_plex_mono.woff2.b64")
    return (
        "@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:400 700;"
        f"font-display:swap;src:url({sans}) format('woff2');}}\n"
        "@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;"
        f"font-display:swap;src:url({mono}) format('woff2');}}"
    )


# Tokens + componentes Carbon. Sem chaves de .format aqui — injetado como valor.
CARBON_CSS = """
:root{
  --bg:#f4f4f4; --panel:#ffffff; --border:#e0e0e0; --border-strong:#c6c6c6;
  --ink:#161616; --ink-2:#525252; --ink-3:#8d8d8d;
  --blue:#0f62fe; --blue-hover:#0043ce;
  --red:#da1e28; --amber:#f1c21b; --green:#24a148;
  --red-tint:#fff1f1; --red-ink:#a2191f;
  --amber-tint:#fcf4d6; --amber-ink:#684e00;
  --green-tint:#defbe6; --green-ink:#0e6027;
  --gray-tint:#e8e8e8; --gray-ink:#393939;
  --zebra:#fafafa; --hover:#f1f6ff; --selected:#edf5ff;
  --sans:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{margin:0;padding:0;box-sizing:border-box;border-radius:0!important}
html{background:var(--bg)}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:14px;line-height:1.4;-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-decoration:none}
a:hover{color:var(--blue-hover);text-decoration:underline}
button,input{font-family:var(--sans)}
:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
.mono{font-family:var(--mono)}
.muted{color:var(--ink-3)}
/* ===== topbar (48px, escura) ===== */
.topbar{position:fixed;top:0;left:0;right:0;height:48px;background:#161616;color:#fff;
  display:flex;align-items:center;z-index:60}
.tb-brand{font-family:var(--mono);font-weight:600;font-size:14px;letter-spacing:.04em;
  padding:0 16px;width:256px;flex:none}
.tb-brand span{color:#8d8d8d;font-weight:400}
.tb-loc{font-family:var(--mono);font-size:12px;color:#c6c6c6;padding:0 16px;
  border-left:1px solid #393939;height:100%;display:flex;align-items:center}
.tb-right{margin-left:auto;height:100%;display:flex;align-items:center}
.tb-extract{font-family:var(--mono);font-size:12px;color:#c6c6c6;padding:0 16px;
  border-left:1px solid #393939;height:100%;display:flex;align-items:center;gap:8px}
.ok-dot{width:8px;height:8px;background:var(--green);display:inline-block;flex:none}
/* ===== sidebar (256px, branca) ===== */
.side{position:fixed;top:48px;left:0;bottom:0;width:256px;background:var(--panel);
  border-right:1px solid var(--border);padding:16px 0;overflow-y:auto;z-index:50}
.side-group{font-family:var(--mono);font-size:11px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-3);padding:8px 16px}
.nav+.side-group{margin-top:16px}
.nav a{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:8px 16px 8px 13px;color:var(--ink-2);font-size:14px;
  border-left:3px solid transparent;text-decoration:none}
.nav a:hover{background:var(--bg);color:var(--ink);text-decoration:none}
.nav a.active{border-left-color:var(--blue);background:var(--selected);
  color:var(--ink);font-weight:600}
.nav .ct{font-family:var(--mono);font-size:12px;color:var(--ink-3)}
/* ===== layout ===== */
.shell{display:block}
.main{margin:48px 0 0 256px;padding:24px 32px 64px;max-width:1480px;
  min-height:calc(100vh - 48px)}
body.dr-open .main{margin-right:360px}
.crumb{font-size:12px;color:var(--ink-2);margin-bottom:4px}
.crumb b{color:var(--ink);font-weight:500}
h1{font-size:24px;font-weight:400;letter-spacing:-.01em;margin-bottom:2px}
.h1-sub{font-family:var(--mono);font-size:12px;color:var(--ink-2);margin-bottom:24px}
.sec-label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);margin:32px 0 8px}
.sec-label:first-of-type{margin-top:0}
/* ===== tiles de problema (estilo notification) ===== */
.triage{display:grid;grid-template-columns:repeat(6,1fr);gap:1px;background:var(--border);
  border:1px solid var(--border)}
.ttile{background:var(--panel);border-top:2px solid var(--border-strong);
  padding:14px 16px 12px;min-height:120px;display:flex;flex-direction:column;cursor:pointer}
.ttile:hover{background:var(--bg)}
.ttile.sev-err{border-top-color:var(--red)}
.ttile.sev-warn{border-top-color:var(--amber)}
.ttile.sev-ok{border-top-color:var(--green)}
.ttile .n{font-family:var(--mono);font-size:28px;font-weight:600;line-height:1.15}
.ttile.sev-err .n{color:var(--red-ink)}
.ttile.sev-ok .n{color:var(--green-ink)}
.ttile .lbl{font-size:12px;font-weight:600;color:var(--ink-2);margin-top:2px}
.ttile .det{font-size:11.5px;color:var(--ink-2);margin-top:4px;flex:1}
.ttile .go{font-size:12px;color:var(--blue);margin-top:8px}
.ttile:hover .go{text-decoration:underline}
a.ttile,a.ttile:hover{color:inherit;text-decoration:none}
/* ===== KPIs ===== */
.kpis{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);
  border:1px solid var(--border)}
.kpi{background:var(--panel);padding:12px 16px}
.kpi .n{font-family:var(--mono);font-size:24px;font-weight:500;line-height:1.2}
.kpi .l{font-size:12px;color:var(--ink-2)}
.kpi .s{font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-top:2px}
.kpi .s em{font-style:normal;color:var(--amber-ink)}
/* ===== card de tabela + barra de busca ===== */
.tbl-card{background:var(--panel);border:1px solid var(--border)}
.tbl-bar{display:flex;align-items:center;border-bottom:1px solid var(--border)}
.tbl-search{flex:1;display:flex;align-items:center;gap:10px;padding:0 16px}
.tbl-search svg{flex:none;color:var(--ink-3)}
.tbl-search input{flex:1;border:none;outline:none;height:40px;font-size:14px;
  color:var(--ink);background:transparent}
.tbl-search input::placeholder{color:var(--ink-3)}
.ftr{font-size:12px;color:var(--ink-2);padding:0 16px;border-left:1px solid var(--border);
  height:40px;display:flex;align-items:center;gap:6px;white-space:nowrap}
.ftr:empty{display:none}
.ftr b{font-family:var(--mono);font-weight:500}
.chip{font-family:var(--mono);font-size:11px;border:1px solid var(--border-strong);
  background:var(--gray-tint);color:var(--gray-ink);padding:3px 8px;cursor:pointer}
.chip:hover{background:var(--border)}
.tbl-wrap{overflow-x:auto}
/* ===== tabelas Carbon (linhas ~40px: nowrap + ellipsis + layout fixo) ===== */
table{width:100%;border-collapse:collapse;table-layout:fixed}
thead th{background:var(--border);font-size:12px;font-weight:600;text-align:left;
  padding:9px 12px;color:var(--ink);border-bottom:1px solid var(--border);
  cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
thead th:hover{background:var(--border-strong)}
thead th.num{text-align:right;font-family:var(--mono)}
tbody td{padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;
  vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tbody tr:last-child td{border-bottom:none}
td.num{text-align:right;font-family:var(--mono);font-size:12px}
tbody tr:nth-child(even){background:var(--zebra)}
tbody tr:hover{background:var(--hover)}
tbody tr.sel{background:var(--selected);box-shadow:inset 3px 0 0 var(--blue)}
tr[data-wf]{cursor:pointer}
.chev{color:var(--ink-3)}
.cell-name{font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.cell-id{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);display:block;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cell-mono{font-family:var(--mono);font-size:11.5px;color:var(--ink-2)}
.empty{padding:24px 16px;font-size:13px;color:var(--ink-3)}
.drill{font-size:12px;color:var(--ink-2);padding:6px 0 2px;white-space:normal}
details summary{cursor:pointer;color:var(--blue);font-family:var(--mono);font-size:12px}
details summary:hover{color:var(--blue-hover)}
/* ===== tags de status (retangulares, fundo claro da severidade) ===== */
.tag{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.02em;
  padding:1px 8px;white-space:nowrap}
.tag.pub,.tag.pass{background:var(--green-tint);color:var(--green-ink)}
.tag.draft{background:var(--gray-tint);color:var(--gray-ink)}
.tag.warn{background:var(--amber-tint);color:var(--amber-ink)}
.tag.err,.tag.fail{background:var(--red-tint);color:var(--red-ink)}
.tag.ok{background:transparent;color:var(--ink-3);font-weight:400}
/* ===== drawer de detalhe (360px à direita) ===== */
.drawer{position:fixed;top:48px;right:0;bottom:0;width:360px;background:var(--panel);
  border-left:1px solid var(--border);z-index:55;display:none;flex-direction:column}
.drawer.open{display:flex}
.dr-head{padding:14px 16px;border-bottom:1px solid var(--border)}
.dr-kicker{display:flex;justify-content:space-between;align-items:center;
  font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);margin-bottom:6px}
.dr-close{background:none;border:none;color:var(--ink-3);font-family:var(--mono);
  font-size:13px;cursor:pointer;padding:2px 6px}
.dr-close:hover{background:var(--gray-tint);color:var(--ink)}
.dr-title{font-size:15px;font-weight:600;line-height:1.3;word-break:break-word}
.dr-id{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:4px;
  word-break:break-all}
.dr-body{padding:8px 0;overflow-y:auto;flex:1}
.dr-row{display:grid;grid-template-columns:104px 1fr;gap:8px;padding:7px 16px;font-size:13px}
.dr-k{color:var(--ink-2);font-size:12px;padding-top:1px}
.dr-v{min-width:0;word-break:break-word}
.dr-chip{display:inline-block;font-family:var(--mono);font-size:11px;
  background:var(--gray-tint);color:var(--gray-ink);padding:1px 6px;margin:0 4px 4px 0}
.dr-find{margin:10px 16px;border:1px solid var(--border);border-top:2px solid var(--amber);
  background:var(--amber-tint);padding:10px 12px}
.dr-find.err{border-top-color:var(--red);background:var(--red-tint)}
.dr-find .fr{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--amber-ink);
  display:flex;gap:8px;align-items:center;margin-bottom:4px}
.dr-find.err .fr{color:var(--red-ink)}
.dr-find p{font-size:12px;color:var(--ink);line-height:1.45;word-break:break-word}
.dr-find p code{font-family:var(--mono);font-size:11px}
.dr-links{margin-top:auto;border-top:1px solid var(--border);display:grid;
  grid-template-columns:1fr 1fr;flex:none}
.dr-links a{padding:11px 16px;font-size:13px;border-right:1px solid var(--border)}
.dr-links a:last-child{border-right:none}
/* ===== scrollbar discreta ===== */
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-strong)}
::-webkit-scrollbar-thumb:hover{background:var(--ink-3)}
/* ===== grafo (vis-network) ===== */
#net{width:100%;height:100vh;background:var(--bg)}
#panel{position:fixed;top:16px;left:16px;z-index:90;padding:16px;max-width:280px;
  background:var(--panel);border:1px solid var(--border)}
.wordmark{font-weight:600;font-size:14px}
#panel .sub{font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-top:4px}
#filters{margin-top:12px}
#filters label{display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer;
  font-family:var(--mono);font-size:11px;color:var(--ink-2)}
#filters label:hover{color:var(--ink)}
#filters .dot{width:8px;height:8px;display:inline-block}
#filters input{accent-color:#0f62fe}
#search{margin-top:12px;width:100%;border:none;border-bottom:1px solid var(--border-strong);
  background:transparent;font-size:13px;color:var(--ink);padding:6px 0;outline:none}
#search:focus{border-bottom-color:var(--blue)}
#legend-missing{margin-top:12px;font-family:var(--mono);font-size:11px;color:var(--red)}
#legend-cycle{margin-top:4px;font-family:var(--mono);font-size:11px;color:var(--amber-ink)}
#info{margin-top:6px;font-family:var(--mono);font-size:11px;color:var(--ink-3)}
/* ===== responsivo ===== */
@media(max-width:1280px){
  .triage{grid-template-columns:repeat(3,1fr)}
  .kpis{grid-template-columns:repeat(4,1fr)}
}
@media(max-width:900px){
  .side{display:none}
  .main{margin-left:0;padding:16px 16px 48px}
  .tb-brand{width:auto}
  .triage,.kpis{grid-template-columns:repeat(2,1fr)}
  .drawer{width:100%}
  body.dr-open .main{margin-right:0}
}
"""


def head_assets() -> str:
    """Bloco <style> com @font-face (fontes embutidas) + tema. Injetar no <head>."""
    return f"<style>{_font_faces()}\n{CARBON_CSS}</style>"


def overlays() -> str:
    """Sem camadas decorativas no tema Carbon. Mantido pela compatibilidade de template."""
    return ""


def topbar(loc: str, extracted: str = "", schema=None) -> str:
    """Barra superior escura 48px: 'automaster/audit' (mono) + locationId; à direita,
    ok-dot verde + 'dump <data> · schema vN' em mono 12px."""
    right = ""
    if extracted:
        label = f"dump {extracted}"
        if schema is not None:
            label += f" · schema v{schema}"
        right = (
            '<span class="tb-extract"><span class="ok-dot"></span>'
            f"{_html.escape(label)}</span>"
        )
    return (
        '<header class="topbar">'
        '<span class="tb-brand">automaster<span>/audit</span></span>'
        f'<span class="tb-loc">{_html.escape(str(loc or ""))}</span>'
        f'<div class="tb-right">{right}</div>'
        "</header>"
    )


# Entidades do dump lidas direto do disco (apresentação, só leitura) para que
# sidebar/topbar fiquem idênticos nas 3 páginas sem tocar nos builders de dados.
_DUMP_ENTITY_FILES = {
    "tags": ("tags.json", "tags"),
    "fields": ("custom_fields.json", "customFields"),
    "pipelines": ("pipelines.json", "pipelines"),
    "users": ("users.json", "users"),
    "custom_values": ("custom_values.json", "customValues"),
    "calendars": ("calendars.json", "calendars"),
}


def shell_meta(dump_dir) -> dict:
    """Lê contadores de inventário + schemaVersion da pasta do dump ao lado do HTML.

    Tolerante a falha (testes escrevem HTML fora de um dump): devolve
    {"counts": None, "schema": None} se a pasta não for um dump legível.
    """
    try:
        d = Path(dump_dir)
        manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        counts: dict[str, int] = {
            "workflows": len(list((d / "workflows").glob("*.json"))),
        }
        for key, (fname, raw_key) in _DUMP_ENTITY_FILES.items():
            p = d / fname
            if not p.exists():
                counts[key] = 0
                continue
            obj = json.loads(p.read_text(encoding="utf-8"))
            raw = obj.get("raw") if isinstance(obj, dict) and "raw" in obj else obj
            items = raw.get(raw_key, []) if isinstance(raw, dict) else []
            counts[key] = len(items) if isinstance(items, list) else 0
        return {"counts": counts, "schema": manifest.get("schemaVersion")}
    except Exception:
        return {"counts": None, "schema": None}


# (chave, rótulo, href relativo na pasta do dump, chave em counts ou None)
_SIDEBAR_GROUPS: list[tuple[str, list[tuple[str, str, str, str | None]]]] = [
    ("Conta", [("overview", "Visão geral", "dashboard.html", None)]),
    ("Inventário", [
        ("workflows", "Workflows", "dashboard.html#workflows", "workflows"),
        ("tags", "Tags", "dashboard.html#tags", "tags"),
        ("fields", "Custom fields", "dashboard.html#fields", "fields"),
        ("pipelines", "Pipelines", "dashboard.html#pipelines", "pipelines"),
        ("users", "Usuários", "dashboard.html#users", "users"),
        ("custom_values", "Custom values", "dashboard.html#custom_values", "custom_values"),
        ("calendars", "Calendários", "dashboard.html#calendars", "calendars"),
    ]),
    ("Análise", [
        ("graph", "Grafo de conexões", "graph.html", None),
        ("journey", "Jornada do contato", "journey.html", None),
        ("validation", "Validação", "validation.html", None),
    ]),
]


def sidebar(active: str, counts: dict | None = None) -> str:
    """Navegação compartilhada entre as 3 páginas (links relativos na pasta do dump).

    `active` marca o item da página atual; `counts` (opcional) liga contadores
    nas chaves workflows/tags/fields/pipelines/users/custom_values/calendars.
    """
    parts = ['<aside class="side">']
    for group, items in _SIDEBAR_GROUPS:
        parts.append(f'<div class="side-group">{_html.escape(group)}</div>')
        parts.append('<nav class="nav">')
        for key, label, href, ckey in items:
            cls = ' class="active"' if key == active else ""
            ct = ""
            if counts is not None and ckey is not None and ckey in counts:
                ct = f'<span class="ct">{_html.escape(str(counts[ckey]))}</span>'
            parts.append(
                f'<a{cls} data-nav="{key}" href="{href}">'
                f"<span>{_html.escape(label)}</span>{ct}</a>"
            )
        parts.append("</nav>")
    parts.append("</aside>")
    return "".join(parts)


# Paleta do grafo na linguagem do demo: workflows em ink, entidades em
# azuis/teals Carbon — categorias se distinguem por FORMA, não por matiz.
# Vermelho #da1e28 (referência quebrada) e âmbar #f1c21b (aresta em ciclo)
# ficam fora de propósito: são exclusivos de status no JS do grafo.
GRAPH_COLORS = {
    "workflow": "#161616",   # ink (quadrado)
    "trigger": "#1192e8",    # cyan 50
    "tag": "#0f62fe",        # blue 60
    "pipeline": "#0043ce",   # blue 70
    "stage": "#007d79",      # teal 60
    "field": "#009d9a",      # teal 50
    "user": "#005d5d",       # teal 70
}
