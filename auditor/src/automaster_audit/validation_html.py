"""Renderiza as 3 camadas de validação como HTML auto-contido — tema "Sala de Controle" (IBM Carbon).

Shell compartilhado (topbar + sidebar) vem de theme.py; tudo renderizado
server-side com html.escape (nomes vêm do CRM = input externo); colapso via
<details> nativo — zero JavaScript, zero requests externos.
"""

from __future__ import annotations

import html as _html
import re
from pathlib import Path

from .theme import head_assets, shell_meta, sidebar, topbar

_SEV_CLS = {"ERROR": "err", "WARN": "warn", "INFO": "info"}
_CASE_CLS = {"PASS": "pass", "FAIL": "fail", "AMBIGUOUS": "warn"}


def _esc(s) -> str:
    return _html.escape("" if s is None else str(s), quote=True)


_ISO_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})")
_DUMP_DIR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$")


def _fmt_extracted(out: Path, fallback) -> str:
    """Data de extração: nome da pasta do dump (igual ao dashboard) ou ISO do manifest."""
    m = _DUMP_DIR_RE.match(out.parent.name)
    if m:
        return f"{m.group(1)} {m.group(2)}:{m.group(3)}"
    m = _ISO_RE.match(str(fallback or ""))
    return f"{m.group(1)} {m.group(2)}:{m.group(3)}" if m else str(fallback or "")


# ------------------------------------------------------------------- CSS ----
# Complementos da página sobre o tema Carbon. Sem chaves de .format aqui —
# injetado como VALOR no template (padrão do projeto).
_PAGE_CSS = """
/* ===== tiles-resumo das 3 camadas ===== */
.triage.val3{grid-template-columns:repeat(3,1fr)}
a.ttile,a.ttile:hover{color:inherit;text-decoration:none}
.ttile .tk{font-family:var(--mono);font-size:11px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
/* mini-barra de distribuição por severidade + swatches (como no demo) */
.vbar{display:flex;height:8px;background:var(--gray-tint);margin:10px 0 8px;overflow:hidden}
.vbar i{display:block;height:100%}
.vstats{display:flex;gap:14px;font-size:12px;color:var(--ink-2);flex-wrap:wrap}
.vstats b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.vstats .sq{display:inline-block;width:8px;height:8px;margin-right:5px}
/* ===== cabeçalho de seção (16px 600 + régua, label numerado em mono) ===== */
.vsec{margin-top:40px}
.vsec-label{font-family:var(--mono);font-size:11px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:4px}
.vsec h2{font-size:16px;font-weight:600;letter-spacing:0;padding-bottom:8px;
  margin-bottom:16px;border-bottom:1px solid var(--border)}
.vsec thead th{cursor:default}
.vsec thead th:hover{background:var(--border)}
td.fdet{color:var(--ink-2);font-size:12.5px;white-space:normal}
/* ===== camada 2: lista de workflows com <details> nativo ===== */
.wflist{background:var(--panel);border:1px solid var(--border)}
details.wf+details.wf{border-top:1px solid var(--border)}
details.wf summary{display:flex;align-items:center;gap:12px;padding:10px 16px;
  cursor:pointer;list-style:none;color:var(--ink);font-family:var(--sans);font-size:13px}
details.wf summary::-webkit-details-marker{display:none}
details.wf summary:hover{background:var(--gray-tint);color:var(--ink)}
details.wf[open]>summary{background:var(--bg);border-bottom:1px solid var(--border)}
.wf-name{font-weight:500;flex:1 1 auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.wf-n{font-family:var(--mono);font-size:12px;color:var(--ink-2);white-space:nowrap}
.wf-caret{font-family:var(--mono);font-size:13px;color:var(--ink-3);
  width:14px;text-align:center;flex:none}
.wf-caret::before{content:"+"}
details[open] .wf-caret::before{content:"\\2212"}
/* árvore: indentação por hairline vertical */
.tree{padding:12px 16px 16px}
.tree ul{list-style:none;padding-left:18px;border-left:1px solid var(--border)}
.tree>ul{padding-left:0;border-left:none}
.tree li{padding:3px 0;font-size:12.5px;color:var(--ink-2);line-height:1.45}
.tree .bl{color:var(--ink);font-weight:600}
.term{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.term.loop{color:var(--amber-ink);background:var(--amber-tint);padding:0 4px}
/* tags complementares (INFO cinza informativo) */
.tag.info{background:var(--gray-tint);color:var(--gray-ink)}
@media(max-width:900px){.triage.val3{grid-template-columns:1fr}}
"""

_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AUTOMASTER // VALIDAÇÃO {title}</title>
{head_assets}
<style>{page_css}</style>
</head><body>
{topbar}
{sidebar}
<main class="main">
<div class="crumb">{loc} / <b>Validação</b></div>
<h1>Validação</h1>
<div class="h1-sub">3 camadas · {n_wf} workflows · extração {extracted}</div>
<div class="sec-label">Resumo · 3 camadas de validação</div>
<div class="triage val3">{tiles}</div>
{sec1}
{sec2}
{sec3}
</main>
</body></html>"""


# ----------------------------------------------------------------- tiles ----

_GRAY_SEG = "#a8a8a8"  # segmento INFO (cinza informativo, como no demo)


def _bar(segs: list[tuple[int, str]], empty: str = "var(--green)") -> str:
    """Mini-barra horizontal de 8px com segmentos proporcionais por severidade."""
    total = sum(n for n, _ in segs)
    if total <= 0:
        return f'<div class="vbar"><i style="width:100%;background:{empty}"></i></div>'
    parts = "".join(f'<i style="width:{n / total * 100:.1f}%;background:{color}"></i>' for n, color in segs if n > 0)
    return f'<div class="vbar">{parts}</div>'


def _stats(items: list[tuple[str | None, object, str]]) -> str:
    """Linha de estatísticas com swatch de 8px antes de cada contagem."""
    spans = []
    for color, num, label in items:
        sq = f'<span class="sq" style="background:{color}"></span>' if color else ""
        spans.append(f"<span>{sq}<b>{_esc(num)}</b> {_esc(label)}</span>")
    return f'<div class="vstats">{"".join(spans)}</div>'


def _tile(href: str, kicker: str, num, label: str, body: str, sev: str) -> str:
    cls = f"ttile {sev}".strip()
    return (
        f'<a class="{cls}" href="{href}">'
        f'<div class="tk">{_esc(kicker)}</div>'
        f'<div class="n">{_esc(num)}</div>'
        f'<div class="lbl">{_esc(label)}</div>'
        f'<div class="det">{body}</div>'
        f'<div class="go">ver →</div></a>'
    )


def _tiles(data: dict) -> str:
    c1, c2, c3 = data["camada1"]["counts"], data["camada2"], data["camada3"]
    sev1 = "sev-err" if c1["ERROR"] else ("sev-warn" if c1["WARN"] else "sev-ok")
    body1 = _bar([(c1["ERROR"], "var(--red)"), (c1["WARN"], "var(--amber)"), (c1["INFO"], _GRAY_SEG)]) + _stats(
        [
            ("var(--red)", c1["ERROR"], "ERROR"),
            ("var(--amber)", c1["WARN"], "WARN"),
            (_GRAY_SEG, c1["INFO"], "INFO"),
        ]
    )
    t1 = _tile("#camada1", "Camada 1", sum(c1.values()), "Auditoria estática", body1, sev1)

    sev2 = "sev-warn" if c2["truncated"] else "sev-ok"
    n_wf2 = len(c2["workflows"])
    stats2 = [(None, c2["total_paths"], "caminhos mapeados"), (None, n_wf2, "workflows")]
    if c2["truncated"]:
        stats2.append(("var(--amber)", c2["truncated"], "truncados"))
    body2 = _bar([(c2["truncated"], "var(--amber)"), (max(n_wf2 - c2["truncated"], 0), "var(--green)")]) + _stats(
        stats2
    )
    t2 = _tile("#camada2", "Camada 2", c2["total_paths"], "Caminhos de execução", body2, sev2)

    if c3.get("disponivel"):
        n3 = c3["counts"]
        sev3 = "sev-err" if n3["FAIL"] else ("sev-warn" if n3["AMBIGUOUS"] else "sev-ok")
        body3 = _bar(
            [(n3["FAIL"], "var(--red)"), (n3["AMBIGUOUS"], "var(--amber)"), (n3["PASS"], "var(--green)")]
        ) + _stats(
            [
                ("var(--green)", n3["PASS"], "PASS"),
                ("var(--red)", n3["FAIL"], "FAIL"),
                ("var(--amber)", n3["AMBIGUOUS"], "AMBIGUOUS"),
            ]
        )
        t3 = _tile("#camada3", "Camada 3", sum(n3.values()), "Testes de contrato", body3, sev3)
    else:
        t3 = _tile("#camada3", "Camada 3", "—", "Testes de contrato", _esc("nenhum contrato disponível"), "")
    return t1 + t2 + t3


# ---------------------------------------------------------------- seções ----


def _section(num: str, anchor: str, label: str, title: str, body: str) -> str:
    return (
        f'<section class="vsec" id="{anchor}">'
        f'<div class="vsec-label">{num} / {label}</div>'
        f"<h2>{_esc(title)}</h2>{body}</section>"
    )


# -------------------------------------------------------------- camada 1 ----


def _sec_camada1(c1: dict) -> str:
    if not c1["achados"]:
        body = '<div class="tbl-card"><div class="empty">nenhum achado</div></div>'
    else:
        rows = "".join(
            "<tr>"
            f'<td><span class="tag {_SEV_CLS.get(a["severity"], "info")}">{_esc(a["severity"])}</span></td>'
            f'<td class="cell-mono">{_esc(a["rule"])}</td>'
            f"<td>{_esc(a['workflow_name']) or '—'}</td>"
            f'<td class="fdet">{_esc(a["detail"])}</td>'
            "</tr>"
            for a in c1["achados"]
        )
        body = (
            '<div class="tbl-card"><div class="tbl-wrap"><table>'
            '<thead><tr><th style="width:110px">Severidade</th>'
            '<th style="width:240px">Regra</th><th style="width:280px">Workflow</th>'
            "<th>Detalhe</th></tr></thead>"
            f"<tbody>{rows}</tbody></table></div></div>"
        )
    return _section("01", "camada1", "CAMADA 1 — AUDITORIA ESTÁTICA", "Auditoria estática", body)


# -------------------------------------------------------------- camada 2 ----


def _split_terminal(text: str) -> tuple[str, str]:
    """Separa o terminal embutido no fim do texto de um caminho ("[fim]", "(loop → X)", "(x)")."""
    if text == "[fim]" or (text.startswith("(") and text.endswith(")")):
        return "", text
    if text.endswith(" → [fim]"):
        return text[: -len(" → [fim]")], "[fim]"
    i = text.rfind(" → (")
    if i >= 0 and text.endswith(")"):
        return text[:i], text[i + len(" → ") :]
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
    disp = _term_display(term)
    cls = "term loop" if disp.startswith("loop") else "term"
    span = f'<span class="{cls}">{_esc(disp)}</span>'
    return f"{_esc(head)} {span}" if head else span


def _tree_html(nodes: list[dict]) -> str:
    if not nodes:
        return ""
    items = "".join(
        f'<li><span class="bl">{_esc(n["text"])}</span>{_tree_html(n["children"])}</li>'
        if n["children"]
        else f"<li>{_leaf_html(n['text'])}</li>"
        for n in nodes
    )
    return f"<ul>{items}</ul>"


def _sec_camada2(c2: dict) -> str:
    parts: list[str] = []
    for w in c2["workflows"]:
        status = str(w["status"] or "")
        scls = "pub" if status.lower() == "published" else "draft"
        n = w["n_paths"]
        meta = [f'<span class="wf-n">{n} caminho{"" if n == 1 else "s"}</span>']
        if w["truncated"]:
            meta.append('<span class="tag warn">truncado</span>')
        meta.append(f'<span class="tag {scls}">{_esc(status.upper()) or "—"}</span>')
        tree = _tree_html(w["tree"]) or '<span class="muted mono">sem steps</span>'
        parts.append(
            f'<details class="wf"><summary>'
            f'<span class="wf-name">{_esc(w["name"])}</span>'
            f'{"".join(meta)}<span class="wf-caret"></span>'
            f'</summary><div class="tree">{tree}</div></details>'
        )
    body = (
        f'<div class="wflist">{"".join(parts)}</div>'
        if parts
        else '<div class="tbl-card"><div class="empty">nenhum workflow no dump</div></div>'
    )
    return _section("02", "camada2", "CAMADA 2 — CAMINHOS DE EXECUÇÃO", "Caminhos de execução", body)


# -------------------------------------------------------------- camada 3 ----


def _sec_camada3(c3: dict) -> str:
    if not c3.get("disponivel"):
        motivo = f" ({_esc(c3['erro'])})" if c3.get("erro") else ""
        body = f'<div class="tbl-card"><div class="empty">nenhum contrato disponível{motivo}</div></div>'
    elif not c3["casos"]:
        body = '<div class="tbl-card"><div class="empty">nenhum caso declarado</div></div>'
    else:
        rows = "".join(
            "<tr>"
            f'<td><span class="tag {_CASE_CLS.get(c["status"], "warn")}">{_esc(c["status"])}</span></td>'
            f"<td>{_esc(c['caso'])}</td>"
            f'<td class="cell-mono">{_esc(c["workflow"])}</td>'
            f'<td class="fdet">{_esc(c["motivo"])}</td>'
            "</tr>"
            for c in c3["casos"]
        )
        body = (
            '<div class="tbl-card"><div class="tbl-wrap"><table>'
            '<thead><tr><th style="width:110px">Status</th>'
            '<th style="width:300px">Caso</th><th style="width:240px">Workflow</th>'
            "<th>Motivo</th></tr></thead>"
            f"<tbody>{rows}</tbody></table></div></div>"
        )
    return _section("03", "camada3", "CAMADA 3 — TESTE DE CONTRATO", "Contratos", body)


# ------------------------------------------------------------------ main ----


def write_validation_html(data: dict, out: Path, title: str = "") -> Path:
    out = Path(out)
    meta = data["meta"]
    loc = str(meta.get("locationId") or title or "dump")
    extracted = _fmt_extracted(out, meta.get("extractedAt"))
    shell = shell_meta(out.parent)  # mesmos contadores da sidebar do dashboard
    html = _TEMPLATE.format(
        title=_esc(title or loc),
        head_assets=head_assets(),
        page_css=_PAGE_CSS,
        topbar=topbar(loc, extracted, schema=shell["schema"]),
        sidebar=sidebar("validation", counts=shell["counts"]),
        loc=_esc(loc),
        n_wf=meta.get("n_workflows", 0),
        extracted=_esc(extracted),
        tiles=_tiles(data),
        sec1=_sec_camada1(data["camada1"]),
        sec2=_sec_camada2(data["camada2"]),
        sec3=_sec_camada3(data["camada3"]),
    )
    out.write_text(html, encoding="utf-8")
    return out
