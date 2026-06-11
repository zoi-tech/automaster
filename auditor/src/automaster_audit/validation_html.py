"""Renderiza as 3 camadas de validação como HTML auto-contido, tema Tron (sem CDN).

Tudo renderizado server-side com html.escape (nomes vêm do CRM = input externo);
colapso via <details> nativo — zero JavaScript, zero requests externos.
"""
from __future__ import annotations

import html as _html
from pathlib import Path

from .theme import head_assets, overlays

_MARK = {"PASS": "✓", "FAIL": "✗", "AMBIGUOUS": "?"}


def _esc(s) -> str:
    return _html.escape("" if s is None else str(s), quote=True)


# CSS extra desta página (injetado como valor — sem chaves de .format no template).
_EXTRA_CSS = """
.layers{display:flex;gap:12px;flex-wrap:wrap;margin:10px}
.layer{flex:1;min-width:250px;padding:14px 18px;border:1px solid var(--line);
  background:linear-gradient(180deg,var(--panel),var(--panel2));
  clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
.layer .t{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--mut)}
.layer .nums{display:flex;gap:22px;margin-top:9px;flex-wrap:wrap}
.layer .nums .n{font-size:24px;color:var(--cyan);text-shadow:0 0 8px rgba(46,230,255,.5)}
.layer .nums .l{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.layer.ok{border-color:var(--green);box-shadow:0 0 16px rgba(77,255,166,.3),inset 0 0 20px rgba(77,255,166,.05)}
.layer.ok .t{color:var(--green);text-shadow:0 0 8px rgba(77,255,166,.5)}
.layer.warn{border-color:var(--amber);box-shadow:0 0 16px rgba(255,178,77,.3),inset 0 0 20px rgba(255,178,77,.05)}
.layer.warn .t{color:var(--amber);text-shadow:0 0 8px rgba(255,178,77,.5)}
.layer.bad{border-color:var(--red);box-shadow:0 0 16px rgba(255,77,109,.35),inset 0 0 20px rgba(255,77,109,.06)}
.layer.bad .t{color:var(--red);text-shadow:0 0 8px rgba(255,77,109,.5)}
.layer.off{opacity:.65}
section.panel{margin:10px;padding:16px 20px}
section.panel h2{margin:0 0 10px;font-size:13px;font-weight:400;text-transform:uppercase;
  letter-spacing:2px;color:var(--cyan);text-shadow:0 0 8px rgba(46,230,255,.5)}
.sev-ERROR{color:var(--red);border-color:var(--red);box-shadow:0 0 6px rgba(255,77,109,.3)}
.sev-WARN{color:var(--amber);border-color:var(--amber)}
.sev-INFO{color:var(--cyan2);border-color:var(--line2)}
details.wfp{margin:6px 0;border:1px solid var(--line);padding:6px 12px;background:rgba(3,10,16,.5)}
details.wfp[open]{border-color:var(--line2)}
details.wfp summary{font-size:12px;text-transform:none}
.tree{margin:8px 0 4px}
.tree ul{list-style:none;margin:0;padding-left:20px;border-left:1px solid var(--line)}
.tree>ul{padding-left:0;border-left:none}
.tree li{padding:2px 0;font-size:12.5px}
.tree li::before{content:'▸ ';color:var(--line2)}
.case{border:1px solid var(--line);padding:8px 12px;margin:6px 0;font-size:12.5px;
  clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))}
.case .mark{display:inline-block;width:18px}
.case.PASS{border-color:var(--green)}.case.PASS .mark{color:var(--green)}
.case.FAIL{border-color:var(--red)}.case.FAIL .mark{color:var(--red)}
.case.AMBIGUOUS{border-color:var(--amber)}.case.AMBIGUOUS .mark{color:var(--amber)}
.case .motivo{color:var(--mut);margin-top:3px}
"""

_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>ENCOM OS // VALIDAÇÃO {title}</title>
{head_assets}
<style>{extra_css}</style>
</head><body>
{overlays}
<header class="framed">
  <div class="hud-top"><span class="dot-online"></span><span class="sub">ENCOM OS // SECTOR {title} // VALIDAÇÃO</span></div>
  <h1>Validação — 3 Camadas</h1>
  <div class="sub">loc {loc} // extraído {extracted} // {n_wf} workflows</div>
</header>
<div class="layers">{layers}</div>
{sec1}
{sec2}
{sec3}
</body></html>"""


def _layer_card(cls: str, title: str, nums: list[tuple[str, object]]) -> str:
    n = "".join(
        f'<div><div class="n">{_esc(v)}</div><div class="l">{_esc(label)}</div></div>'
        for label, v in nums
    )
    return f'<div class="layer {cls}"><div class="t">{_esc(title)}</div><div class="nums">{n}</div></div>'


def _layers(data: dict) -> str:
    c1, c2, c3 = data["camada1"]["counts"], data["camada2"], data["camada3"]
    cls1 = "bad" if c1["ERROR"] else ("warn" if c1["WARN"] else "ok")
    cls2 = "warn" if c2["truncated"] else "ok"
    if not c3.get("disponivel"):
        cls3, nums3 = "off", [("contratos", "—")]
    else:
        n3 = c3["counts"]
        cls3 = "bad" if n3["FAIL"] else ("warn" if n3["AMBIGUOUS"] else "ok")
        nums3 = [("pass", n3["PASS"]), ("fail", n3["FAIL"]), ("ambiguous", n3["AMBIGUOUS"])]
    return (
        _layer_card(cls1, "Camada 1 // Regras",
                    [("error", c1["ERROR"]), ("warn", c1["WARN"]), ("info", c1["INFO"])])
        + _layer_card(cls2, "Camada 2 // Caminhos",
                      [("caminhos", c2["total_paths"]), ("workflows", len(c2["workflows"])),
                       ("truncados", c2["truncated"])])
        + _layer_card(cls3, "Camada 3 // Contratos", nums3)
    )


def _sec_camada1(c1: dict) -> str:
    if not c1["achados"]:
        body = '<p class="muted">nenhum achado — tudo limpo.</p>'
    else:
        rows = "".join(
            f'<tr><td><span class="pill sev-{_esc(a["severity"])}">{_esc(a["severity"])}</span></td>'
            f'<td>{_esc(a["rule"])}</td>'
            f'<td>{_esc(a["workflow_name"]) or "<span class=muted>—</span>"}</td>'
            f'<td>{_esc(a["detail"])}</td></tr>'
            for a in c1["achados"]
        )
        body = (f"<table><thead><tr><th>Severidade</th><th>Regra</th><th>Workflow</th>"
                f"<th>Detalhe</th></tr></thead><tbody>{rows}</tbody></table>")
    return f'<section class="panel"><h2>Camada 1 — Regras de auditoria</h2>{body}</section>'


def _tree_html(nodes: list[dict]) -> str:
    if not nodes:
        return ""
    items = "".join(f"<li>{_esc(n['text'])}{_tree_html(n['children'])}</li>" for n in nodes)
    return f"<ul>{items}</ul>"


def _sec_camada2(c2: dict) -> str:
    parts: list[str] = []
    for w in c2["workflows"]:
        trunc = ' <span class="pill orphan">truncado</span>' if w["truncated"] else ""
        tree = _tree_html(w["tree"]) or '<p class="muted">(sem steps)</p>'
        parts.append(
            f'<details class="wfp"><summary>'
            f'<span class="pill {_esc(w["status"])}">{_esc(w["status"])}</span> '
            f'{_esc(w["name"])} <span class="muted">// {w["n_paths"]} caminho(s)</span>{trunc}'
            f'</summary><div class="tree">{tree}</div></details>'
        )
    body = "".join(parts) or '<p class="muted">nenhum workflow no dump.</p>'
    return f'<section class="panel"><h2>Camada 2 — Caminhos de execução</h2>{body}</section>'


def _sec_camada3(c3: dict) -> str:
    if not c3.get("disponivel"):
        motivo = f' <span class="muted">({_esc(c3["erro"])})</span>' if c3.get("erro") else ""
        body = f'<p class="muted">nenhum contrato disponível{motivo}</p>'
    else:
        cards = "".join(
            f'<div class="case {_esc(c["status"])}">'
            f'<span class="mark">{_MARK.get(c["status"], "?")}</span>'
            f'{_esc(c["status"])} — {_esc(c["workflow"])} // {_esc(c["caso"])}'
            + (f'<div class="motivo">{_esc(c["motivo"])}</div>' if c["motivo"] else "")
            + "</div>"
            for c in c3["casos"]
        )
        body = cards or '<p class="muted">nenhum caso declarado.</p>'
    return f'<section class="panel"><h2>Camada 3 — Contratos de teste</h2>{body}</section>'


def write_validation_html(data: dict, out: Path, title: str = "") -> Path:
    out = Path(out)
    meta = data["meta"]
    html = _TEMPLATE.format(
        title=_esc(title or meta.get("locationId") or "dump"),
        head_assets=head_assets(),
        extra_css=_EXTRA_CSS,
        overlays=overlays(),
        loc=_esc(meta.get("locationId")),
        extracted=_esc(meta.get("extractedAt")),
        n_wf=meta.get("n_workflows", 0),
        layers=_layers(data),
        sec1=_sec_camada1(data["camada1"]),
        sec2=_sec_camada2(data["camada2"]),
        sec3=_sec_camada3(data["camada3"]),
    )
    out.write_text(html, encoding="utf-8")
    return out
