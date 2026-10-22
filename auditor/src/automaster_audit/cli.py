"""CLI do auditor: `automaster-audit <pasta-do-dump>`."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import rules
from .contract import ContractError, format_results, run_contracts
from .diff import build_diff, write_diff
from .ficha import gerar_fichas
from .finding import ERROR, INFO, WARN
from .flow import enumerate_paths
from .loader import DumpError, load_dump
from .mcp_server import WF_EDITAR_ACOES
from .path_report import write_paths_report
from .report import write_reports


def run_audit(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2

    findings = rules.run_all(ctx)
    md_path, json_path = write_reports(ctx, findings, args.dump_path)

    n_err = sum(1 for f in findings if f.severity == ERROR)
    n_warn = sum(1 for f in findings if f.severity == WARN)
    n_info = sum(1 for f in findings if f.severity == INFO)
    print(f"{len(ctx.workflows)} workflows auditados.")
    print(f"achados: {n_err} ERROR, {n_warn} WARN, {n_info} INFO")
    print(f"relatórios: {md_path}, {json_path}")

    # exit code não-zero se houver ERROR (útil em CI)
    return 1 if n_err else 0


def run_paths(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    out = args.output or (Path(args.dump_path) / "paths.md")
    write_paths_report(ctx, out)
    n_paths = 0
    n_trunc = 0
    for wf in ctx.workflows:
        paths, truncated = enumerate_paths(wf)
        n_paths += len(paths)
        n_trunc += 1 if truncated else 0
    print(f"{len(ctx.workflows)} workflows, {n_paths} caminhos enumerados.")
    if n_trunc:
        print(f"atenção: {n_trunc} workflow(s) truncado(s) no cap de caminhos", file=sys.stderr)
    print(f"relatório: {out}")
    return 0


def run_ficha(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    try:
        md = gerar_fichas(ctx, args.workflow)
    except ValueError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    if args.output:
        Path(args.output).write_text(md, encoding="utf-8")
        print(f"fichas: {args.output}")
    else:
        sys.stdout.write(md)
    return 0


def run_verify_contracts(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    try:
        results = run_contracts(ctx, args.contracts)
    except ContractError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    print(format_results(results))
    return 1 if any(r.status == "FAIL" for r in results) else 0


def run_diff(args: argparse.Namespace) -> int:
    try:
        antes = load_dump(args.antes)
        depois = load_dump(args.depois)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    diff = build_diff(antes, depois)
    out = args.output or (Path(args.depois) / "diff.md")
    write_diff(diff, out)
    w = diff["workflows"]
    if not diff["mesma_subconta"]:
        print("atenção: os dois dumps são de subcontas diferentes", file=sys.stderr)
    print(f"workflows: +{len(w['adicionados'])} -{len(w['removidos'])} ~{len(w['alterados'])} alterados")
    for tipo, e in diff["entidades"].items():
        print(f"{tipo}: +{len(e['adicionados'])} -{len(e['removidos'])}")
    print(f"relatório: {out}")
    return 0


def run_workflow_editar(args: argparse.Namespace) -> int:
    """ESCREVE workflow ao vivo passando pela validação das 29 regras.

    Mesma orquestração da tool MCP (prévia → validação → gravação): esta função só
    dá uma porta de linha de comando para ela. `npm run workflow-editar` é a camada
    crua e grava sem passar por regra nenhuma; quem quer a guarda entra por aqui.
    """
    # lazy de propósito: deixa o teste trocar `mcp_server.workflow_editar` por um dublê.
    from . import mcp_server

    campos = (
        "loc",
        "acao",
        "id",
        "nome",
        "pasta",
        "de",
        "para",
        "step",
        "caminho",
        "valor",
        "campo",
        "trigger_acao",
        "trigger_id",
        "trigger_corpo",
        "corpo",
        "depois_de",
        "ramos",
        "com_subarvore",
        "confirmo",
        "publicado",
        "snapshot",
    )
    try:
        r = mcp_server.workflow_editar(**{c: getattr(args, c) for c in campos})
    except mcp_server.ToolError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    print(json.dumps(r, ensure_ascii=False))
    aplicado = r.get("aplicado")
    if aplicado is True:
        return 0
    # "duvidoso" é gravação que a releitura não confirmou: não pode sair como sucesso
    # para quem lê o código de saída num roteiro.
    return 3 if aplicado == "duvidoso" else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="automaster-audit", description="Audita um dump de workflows GHL.")
    sub = parser.add_subparsers(required=True)
    p_audit = sub.add_parser("audit", help="audita uma pasta de dump")
    p_audit.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_audit.set_defaults(func=run_audit)

    p_paths = sub.add_parser("paths", help="enumera caminhos de execução por workflow (Markdown)")
    p_paths.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_paths.add_argument("-o", "--output", type=Path, help="arquivo MD de saída (default: <dump>/paths.md)")
    p_paths.set_defaults(func=run_paths)

    p_ficha = sub.add_parser("ficha", help="ficha por workflow: configurações, gatilhos e passos (Markdown)")
    p_ficha.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_ficha.add_argument("-o", "--output", type=Path, help="arquivo MD de saída (default: stdout)")
    p_ficha.add_argument("--workflow", help="id do workflow: limita a ficha a ele")
    p_ficha.set_defaults(func=run_ficha)

    p_vc = sub.add_parser("verify-contracts", help="roda contratos de teste contra o dump (PASS/FAIL/AMBIGUOUS)")
    p_vc.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_vc.add_argument(
        "--contracts", type=Path, default=Path("contracts"), help="dir dos contratos *.json (default: contracts/)"
    )
    p_vc.set_defaults(func=run_verify_contracts)

    p_diff = sub.add_parser("diff", help="compara dois dumps da mesma subconta (Markdown)")
    p_diff.add_argument("antes", type=Path, help="pasta do dump mais antigo")
    p_diff.add_argument("depois", type=Path, help="pasta do dump mais recente")
    p_diff.add_argument("-o", "--output", type=Path, help="arquivo MD de saída (default: <depois>/diff.md)")
    p_diff.set_defaults(func=run_diff)

    p_we = sub.add_parser(
        "workflow-editar", help="ESCREVE workflow ao vivo com a validação das 29 regras (a guarda da tool MCP)"
    )
    p_we.add_argument("-l", "--loc", required=True, help="locationId da subconta")
    p_we.add_argument("--acao", required=True, choices=WF_EDITAR_ACOES, help="operação a aplicar")
    p_we.add_argument("-i", "--id", help="id do workflow (obrigatório fora de 'criar')")
    p_we.add_argument("--nome", help="nome (criar/renomear/duplicar)")
    p_we.add_argument("--pasta", help="id da pasta (obrigatório em criar/duplicar)")
    p_we.add_argument("--de", help="id ou tag de origem (trocar-ref/trocar-tag)")
    p_we.add_argument("--para", help="id ou tag de destino (trocar-ref/trocar-tag)")
    p_we.add_argument("--step", help="id do step (atributo, step-remover, step-mover)")
    p_we.add_argument("--caminho", help="caminho do campo dentro do step (atributo)")
    p_we.add_argument("--valor", help="valor novo do campo (atributo; configuracao: valor da configuração geral)")
    p_we.add_argument("--campo", help="configuração geral do workflow (configuracao): allowMultiple")
    p_we.add_argument(
        "--trigger-acao", choices=("adicionar", "remover", "substituir"), help="operação de trigger (acao=trigger)"
    )
    p_we.add_argument("--trigger-id", help="id do trigger (remover/substituir)")
    p_we.add_argument("--trigger-corpo", help="JSON do trigger novo (adicionar/substituir)")
    p_we.add_argument("--corpo", help="JSON do step novo (step-criar)")
    p_we.add_argument("--depois-de", help="id do step que fica logo antes; sem ele step-criar põe no início")
    p_we.add_argument("--ramos", help="lista JSON de ramos: o step nasce container (step-criar)")
    p_we.add_argument(
        "--com-subarvore", action="store_true", help="step-remover: container sai levando ramos e tudo que pende deles"
    )
    p_we.add_argument(
        "--confirmo", action="store_true", help="grava de verdade; sem ele devolve só a prévia com o diff"
    )
    p_we.add_argument("--publicado", action="store_true", help="obrigatório junto de --confirmo em workflow publicado")
    p_we.add_argument("--snapshot", help="snapshot do dump usado na validação (default: o último)")
    p_we.set_defaults(func=run_workflow_editar)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    # atalho: se o 1º argumento for um caminho existente, assume subcomando 'audit'
    raw = list(sys.argv[1:] if argv is None else argv)
    if (
        raw
        and raw[0]
        not in (
            "audit",
            "paths",
            "ficha",
            "verify-contracts",
            "diff",
            "workflow-editar",
            "-h",
            "--help",
        )
        and Path(raw[0]).exists()
    ):
        raw = ["audit", *raw]
    args = parser.parse_args(raw)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
