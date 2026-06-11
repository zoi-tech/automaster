"""Renderiza as 3 camadas de validação como HTML auto-contido — linguagem editorial monocromática.

Tudo renderizado server-side com html.escape (nomes vêm do CRM = input externo);
colapso via <details> nativo — zero JavaScript, zero requests externos.
Fontes (Inter variável + Share Tech Mono) embutidas como data-URI a partir de assets/.
"""
from __future__ import annotations

import html as _html
from pathlib import Path

_ASSETS = Path(__file__).parent / "assets"

_SEV_CLS = {"ERROR": "t-error", "WARN": "t-warn", "INFO": "t-info"}
_CASE_CLS = {"PASS": "t-pass", "FAIL": "t-fail", "AMBIGUOUS": "t-amb"}


def _esc(s) -> str:
    return _html.escape("" if s is None else str(s), quote=True)


# ---------------------------------------------------------------- fontes ----

def _font_data_uri(asset: str) -> str:
    b64 = (_ASSETS / asset).read_text(encoding="utf-8").strip().replace("\n", "")
    return f"data:font/woff2;base64,{b64}"


def _font_faces() -> str:
    """@font-face embutidos: Inter variável (100–900) + Share Tech Mono (rótulos técnicos)."""
    inter = _font_data_uri("inter.woff2.b64")
    mono = _font_data_uri("share_tech_mono.woff2.b64")
    return (
        "@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;"
        f"font-display:swap;src:url({inter}) format('woff2');}}\n"
        "@font-face{font-family:'Share Tech Mono';font-style:normal;font-weight:400;"
        f"font-display:swap;src:url({mono}) format('woff2');}}"
    )


# ------------------------------------------------------------------- CSS ----
# Sem chaves de .format aqui — injetado como valor.
_CSS = """
:root{
  --bg:#060606; --fg:#fff; --mut:rgba(255,255,255,.55); --line:rgba(255,255,255,.12);
  --ifg:#060606; --imut:rgba(6,6,6,.55); --iline:rgba(6,6,6,.15); --ifaint:rgba(6,6,6,.45);
}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg)}
body{background:var(--bg);color:var(--fg);
  font-family:'Inter',"Helvetica Neue",Arial,sans-serif;
  font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.mono{font-family:'Share Tech Mono',ui-monospace,monospace;font-size:11px;
  text-transform:uppercase;letter-spacing:.08em}
section{padding:96px 40px}
.inner{max-width:1180px;margin:0 auto}
/* topo */
header{border-bottom:1px solid var(--line)}
.topbar{max-width:1180px;margin:0 auto;padding:20px 40px;
  display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.wordmark{font-size:14px;font-weight:600}
.topmeta{color:var(--mut)}
/* hero */
.hero h1{font-size:clamp(56px,9vw,100px);font-weight:400;letter-spacing:-.03em;line-height:.98}
.hero h1 span{display:block}
.lede{max-width:520px;margin-top:28px;color:var(--mut)}
/* faixa de stats */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;
  border-top:1px solid var(--line);padding-top:40px}
.num{font-size:72px;font-weight:400;letter-spacing:-.02em;line-height:1.1}
.cap{color:var(--mut);margin-top:8px}
/* seções */
section.light{background:#fff;color:var(--ifg)}
.label{padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:56px;color:var(--mut)}
section.light .label{border-color:var(--iline);color:var(--imut)}
h2{font-size:60px;font-weight:400;letter-spacing:-.03em;line-height:1.05;margin-bottom:48px}
/* tags */
.tag{font-family:'Share Tech Mono',ui-monospace,monospace;font-size:10px;text-transform:uppercase;
  letter-spacing:.1em;padding:4px 10px;display:inline-block;justify-self:start}
.t-error,.t-pass{background:#060606;color:#fff}
.t-warn,.t-fail{border:1px solid #060606;color:#060606;background:transparent}
.t-info,.t-amb{color:var(--ifaint)}
/* camada 1 — achados */
.frow{display:grid;grid-template-columns:110px 220px 260px 1fr;gap:24px;align-items:baseline;
  padding:18px 0;border-top:1px solid var(--iline)}
.flist{border-bottom:1px solid var(--iline)}
.frow .rule{font-family:'Share Tech Mono',ui-monospace,monospace;font-size:12px}
.frow .wfn{font-size:15px}
.frow .det{font-size:13px;color:var(--imut)}
.row-none{padding:18px 0;border-top:1px solid var(--iline);border-bottom:1px solid var(--iline);
  font-size:13px;color:var(--imut)}
section.dark .row-none{border-color:var(--line);color:var(--mut)}
/* camada 2 — workflows */
details.wf{border-top:1px solid var(--line)}
.wflist{border-bottom:1px solid var(--line)}
details.wf summary{display:flex;align-items:center;gap:18px;padding:22px 0;cursor:pointer;list-style:none}
details.wf summary::-webkit-details-marker{display:none}
.wfname{font-size:18px;font-weight:600;flex:1 1 auto;min-width:0}
.wfmeta{display:flex;align-items:center;gap:14px;flex:0 0 auto}
.wfmeta .mono{color:var(--mut)}
.stag{font-family:'Share Tech Mono',ui-monospace,monospace;font-size:10px;text-transform:uppercase;
  letter-spacing:.1em;padding:4px 10px}
.stag.pub{border:1px solid #fff;color:#fff}
.stag.drf{color:var(--mut)}
.plus{width:20px;text-align:center;font-size:20px;font-weight:400;color:var(--mut)}
.plus::before{content:"+"}
details[open] .plus::before{content:"\\2212"}
.tree{padding:2px 0 28px}
.tree ul{list-style:none;padding-left:20px;border-left:1px solid var(--line)}
.tree>ul{padding-left:0;border-left:none}
.tree li{padding:4px 0;font-size:13px;color:var(--mut)}
.tree .bl{color:#fff;font-weight:600}
.term{font-family:'Share Tech Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.08em}
/* camada 3 — contratos */
.crow{display:grid;grid-template-columns:110px 280px 220px 1fr;gap:24px;align-items:baseline;
  padding:18px 0;border-top:1px solid var(--iline)}
.clist{border-bottom:1px solid var(--iline)}
.crow .cname{font-size:15px}
.crow .cwf{font-family:'Share Tech Mono',ui-monospace,monospace;font-size:12px}
.crow .cmot{font-size:13px;color:var(--imut)}
/* rodapé */
footer{border-top:1px solid var(--line);padding:96px 0 32px;overflow:hidden}
.giant{font-size:17.4vw;font-weight:600;letter-spacing:-.04em;line-height:.9;color:#fff;
  white-space:nowrap;padding:0;margin-left:-.04em}
.footline{color:var(--mut);max-width:1180px;margin:0 auto;padding:28px 40px 0}
@media(max-width:760px){
  .frow,.crow,.stats{grid-template-columns:1fr;gap:8px}
  section{padding:64px 24px}
}
"""

_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AUTOMASTER // VALIDAÇÃO {title}</title>
<style>{fonts}
{css}</style>
</head><body>
<header><div class="topbar">
  <span class="wordmark">automaster</span>
  <span class="topmeta mono">{loc} · {extracted} · {n_wf} workflows</span>
</div></header>
<section class="hero dark"><div class="inner">
  <h1><span>Validação</span><span>3 camadas</span></h1>
  <p class="lede">Auditoria estática, enumeração de caminhos e teste de contrato sobre o dump {loc}.</p>
</div></section>
<section class="dark"><div class="inner"><div class="stats">{stats}</div></div></section>
{sec1}
{sec2}
{sec3}
<footer>
  <div class="giant">automaster</div>
  <div class="footline mono">automaster-audit validation · {extracted}</div>
</footer>
</body></html>"""


# ----------------------------------------------------------------- stats ----

def _stat(num, caption: str) -> str:
    return (f'<div class="stat"><div class="num">{_esc(num)}</div>'
            f'<div class="cap mono">{_esc(caption)}</div></div>')


def _stats(data: dict) -> str:
    c1, c2, c3 = data["camada1"]["counts"], data["camada2"], data["camada3"]
    s1 = _stat(c1["ERROR"], f"ERROS · {c1['WARN']} WARN · {c1['INFO']} INFO")
    s2 = _stat(c2["total_paths"],
               f"CAMINHOS · {len(c2['workflows'])} WORKFLOWS · {c2['truncated']} TRUNCADOS")
    if c3.get("disponivel"):
        n3 = c3["counts"]
        s3 = _stat(n3["PASS"], f"CONTRATOS PASS · {n3['FAIL']} FAIL · {n3['AMBIGUOUS']} AMBIGUOUS")
    else:
        s3 = _stat("—", "SEM CONTRATOS")
    return s1 + s2 + s3


# -------------------------------------------------------------- camada 1 ----

def _sec_camada1(c1: dict) -> str:
    if not c1["achados"]:
        body = '<div class="row-none">nenhum achado</div>'
    else:
        rows = "".join(
            f'<div class="frow">'
            f'<span class="tag {_SEV_CLS.get(a["severity"], "t-info")}">{_esc(a["severity"])}</span>'
            f'<span class="rule">{_esc(a["rule"])}</span>'
            f'<span class="wfn">{_esc(a["workflow_name"]) or "—"}</span>'
            f'<span class="det">{_esc(a["detail"])}</span></div>'
            for a in c1["achados"]
        )
        body = f'<div class="flist">{rows}</div>'
    return ('<section class="light"><div class="inner">'
            '<div class="label mono">// CAMADA 1 — AUDITORIA ESTÁTICA</div>'
            f'<h2>Achados</h2>{body}</div></section>')


# -------------------------------------------------------------- camada 2 ----

def _split_terminal(text: str) -> tuple[str, str]:
    """Separa o terminal embutido no fim do texto de um caminho ("[fim]", "(loop → X)", "(x)")."""
    if text == "[fim]" or (text.startswith("(") and text.endswith(")")):
        return "", text
    if text.endswith(" → [fim]"):
        return text[: -len(" → [fim]")], "[fim]"
    i = text.rfind(" → (")
    if i >= 0 and text.endswith(")"):
        return text[:i], text[i + len(" → "):]
    return text, ""


def _term_display(term: str) -> str:
    if term == "[fim]":
        return "→ fim"
    inner = term[1:-1] if term.startswith("(") and term.endswith(")") else term
    return inner if inner.startswith("loop") else f"→ {inner}"


def _leaf_html(text: str) -> str:
    head, term = _split_terminal(text)
    if not term:
        return _esc(text)
    span = f'<span class="term">{_esc(_term_display(term))}</span>'
    return f"{_esc(head)} {span}" if head else span


def _tree_html(nodes: list[dict]) -> str:
    if not nodes:
        return ""
    items = "".join(
        f'<li><span class="bl">{_esc(n["text"])}</span>{_tree_html(n["children"])}</li>'
        if n["children"] else f"<li>{_leaf_html(n['text'])}</li>"
        for n in nodes
    )
    return f"<ul>{items}</ul>"


def _sec_camada2(c2: dict) -> str:
    parts: list[str] = []
    for w in c2["workflows"]:
        status = str(w["status"] or "")
        scls = "pub" if status.lower() == "published" else "drf"
        n = w["n_paths"]
        meta = [f'<span class="mono">{n} caminho{"" if n == 1 else "s"}</span>',
                f'<span class="stag {scls}">{_esc(status.upper())}</span>']
        if w["truncated"]:
            meta.append('<span class="mono">⚠ truncado</span>')
        tree = _tree_html(w["tree"]) or '<div class="mono" style="color:var(--mut)">sem steps</div>'
        parts.append(
            f'<details class="wf"><summary>'
            f'<span class="wfname">{_esc(w["name"])}</span>'
            f'<span class="wfmeta">{"".join(meta)}</span>'
            f'<span class="plus"></span>'
            f'</summary><div class="tree">{tree}</div></details>'
        )
    body = (f'<div class="wflist">{"".join(parts)}</div>' if parts
            else '<div class="row-none">nenhum workflow no dump</div>')
    return ('<section class="dark"><div class="inner">'
            '<div class="label mono">// CAMADA 2 — CAMINHOS DE EXECUÇÃO</div>'
            f'<h2>O que cada workflow faz</h2>{body}</div></section>')


# -------------------------------------------------------------- camada 3 ----

def _sec_camada3(c3: dict) -> str:
    if not c3.get("disponivel"):
        motivo = f' ({_esc(c3["erro"])})' if c3.get("erro") else ""
        body = f'<div class="row-none">nenhum contrato disponível{motivo}</div>'
    elif not c3["casos"]:
        body = '<div class="row-none">nenhum caso declarado</div>'
    else:
        rows = "".join(
            f'<div class="crow">'
            f'<span class="tag {_CASE_CLS.get(c["status"], "t-amb")}">{_esc(c["status"])}</span>'
            f'<span class="cname">{_esc(c["caso"])}</span>'
            f'<span class="cwf">{_esc(c["workflow"])}</span>'
            f'<span class="cmot">{_esc(c["motivo"])}</span></div>'
            for c in c3["casos"]
        )
        body = f'<div class="clist">{rows}</div>'
    return ('<section class="light"><div class="inner">'
            '<div class="label mono">// CAMADA 3 — TESTE DE CONTRATO</div>'
            f'<h2>Contratos</h2>{body}</div></section>')


# ------------------------------------------------------------------ main ----

def write_validation_html(data: dict, out: Path, title: str = "") -> Path:
    out = Path(out)
    meta = data["meta"]
    html = _TEMPLATE.format(
        title=_esc(title or meta.get("locationId") or "dump"),
        fonts=_font_faces(),
        css=_CSS,
        loc=_esc(meta.get("locationId")),
        extracted=_esc(meta.get("extractedAt")),
        n_wf=meta.get("n_workflows", 0),
        stats=_stats(data),
        sec1=_sec_camada1(data["camada1"]),
        sec2=_sec_camada2(data["camada2"]),
        sec3=_sec_camada3(data["camada3"]),
    )
    out.write_text(html, encoding="utf-8")
    return out
