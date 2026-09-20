"""Gera report.md + report.json na pasta do dump."""
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .finding import ERROR, INFO, WARN, Finding
from .loader import DumpContext

_ORDER = {ERROR: 0, WARN: 1, INFO: 2}


def write_reports(ctx: DumpContext, findings: list[Finding], out_dir: Path) -> tuple[Path, Path]:
    out_dir = Path(out_dir)
    json_path = out_dir / "report.json"
    md_path = out_dir / "report.md"

    json_path.write_text(
        json.dumps([asdict(f) for f in findings], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    md_path.write_text(_render_md(ctx, findings), encoding="utf-8")
    return md_path, json_path


def _counts(findings: list[Finding]) -> dict[str, int]:
    c = {ERROR: 0, WARN: 0, INFO: 0}
    for f in findings:
        c[f.severity] = c.get(f.severity, 0) + 1
    return c


# lista opcional que falta no dump -> (arquivo, regras que ficam no-op)
_CEGAS = [
    (lambda ctx: "message" not in ctx.template_ids and "whatsapp" not in ctx.template_ids,
     "message_templates.json / whatsapp_templates.json", "broken_template_ref"),
    (lambda ctx: not ctx.form_ids,
     "forms.json / surveys.json", "broken_form_ref, unused_form"),
    (lambda ctx: "email" not in ctx.template_ids,
     "email_templates.json", "stale_email_template, unused_email_template"),
]


def _render_md(ctx: DumpContext, findings: list[Finding]) -> str:
    c = _counts(findings)
    loc = ctx.manifest.get("locationId", "?")
    extracted = ctx.manifest.get("extractedAt", "?")
    lines = [
        f"# Relatório de auditoria — {loc}",
        "",
        f"- Extraído em: {extracted}",
        f"- Workflows: {len(ctx.workflows)}",
        f"- Pipelines: {len(ctx.pipeline_ids)} | Tags: {len(ctx.tag_names)} | Custom fields: {len(ctx.field_ids)}",
        "",
        "## Sumário",
        "",
        f"| Severidade | Achados |",
        f"|---|---|",
        f"| ERROR | {c[ERROR]} |",
        f"| WARN | {c[WARN]} |",
        f"| INFO | {c[INFO]} |",
        "",
    ]

    cegas = [(arq, regras) for falta, arq, regras in _CEGAS if falta(ctx)]
    if cegas:
        lines += [
            "## Regras cegas",
            "",
            "O dump é anterior a estas listas, então as regras abaixo não rodaram. "
            "Ausência de achado aqui não é prova de que está tudo certo — re-extraia a "
            "subconta para valer.",
            "",
            "| Lista ausente | Regra sem efeito |",
            "|---|---|",
        ]
        lines += [f"| {arq} | {regras} |" for arq, regras in cegas]
        lines.append("")

    if not findings:
        lines += ["## Achados", "", "Nenhum achado. ✅", ""]
        return "\n".join(lines)

    lines += ["## Achados", "", "| Severidade | Regra | Workflow | Detalhe |", "|---|---|---|---|"]
    for f in sorted(findings, key=lambda x: (_ORDER.get(x.severity, 9), x.rule, x.workflow_name or "")):
        wf = f.workflow_name or f.workflow_id or "—"
        detail = (f.detail or "").replace("|", "\\|")
        lines.append(f"| {f.severity} | {f.rule} | {wf} | {detail} |")
    lines.append("")
    return "\n".join(lines)
