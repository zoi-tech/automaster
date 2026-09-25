"""CLI do auditor: `automaster-audit <pasta-do-dump>`."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import rules
from .contract import ContractError, format_results, run_contracts
from .dashboard import build_dashboard
from .dashboard_html import write_dashboard_html
from .diff import build_diff, write_diff
from .finding import ERROR, INFO, WARN
from .flow import enumerate_paths
from .graph import build_graph
from .graph_html import write_graph_html
from .journey import DEFAULT_MAX_DEPTH, DEFAULT_MAX_NODES, build_journey
from .journey_html import write_journey_html
from .loader import DumpError, load_dump
from .mcp_server import WF_EDITAR_ACOES
from .path_report import write_paths_report
from .report import write_reports
from .validation import build_validation
from .validation_html import write_validation_html


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


def run_graph(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    graph = build_graph(ctx)
    out = args.output or (Path(args.dump_path) / "graph.html")
    title = ctx.manifest.get("locationId", "")
    write_graph_html(graph, out, title=title)
    print(f"grafo: {len(graph['nodes'])} nós, {len(graph['edges'])} conexões")
    print(f"abra no browser: {out}")
    return 0


def run_dashboard(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    data = build_dashboard(ctx)
    out = args.output or (Path(args.dump_path) / "dashboard.html")
    write_dashboard_html(data, out, title=ctx.manifest.get("locationId", ""))
    s = data["summary"]
    print(
        f"painel: {s['workflows']} workflows, {s['tags']} tags ({s['tags_orphan']} órfãs), "
        f"{s['fields']} fields ({s['fields_orphan']} órfãos)"
    )
    print(f"abra no browser: {out}")
    return 0


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


def run_validation(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    data = build_validation(ctx, contracts_dir=args.contracts)
    out = args.output or (Path(args.dump_path) / "validation.html")
    write_validation_html(data, out, title=ctx.manifest.get("locationId", ""))
    c1, c2, c3 = data["camada1"]["counts"], data["camada2"], data["camada3"]
    print(f"camada 1: {c1['ERROR']} ERROR, {c1['WARN']} WARN, {c1['INFO']} INFO")
    trunc = f" — {c2['truncated']} truncado(s)" if c2["truncated"] else ""
    print(f"camada 2: {c2['total_paths']} caminhos em {data['meta']['n_workflows']} workflows{trunc}")
    if c3.get("disponivel"):
        n = c3["counts"]
        print(f"camada 3: {n['PASS']} PASS, {n['FAIL']} FAIL, {n['AMBIGUOUS']} AMBIGUOUS")
    else:
        erro = f" ({c3['erro']})" if c3.get("erro") else ""
        print(f"camada 3: nenhum contrato disponível{erro}")
    print(f"abra no browser: {out}")
    return 0  # relatório, não gate — sempre 0


def run_journey(args: argparse.Namespace) -> int:
    try:
        ctx = load_dump(args.dump_path)
    except DumpError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2
    data = build_journey(ctx, max_depth=args.max_depth, max_nodes=args.max_nodes)
    out = args.output or (Path(args.dump_path) / "journey.html")
    write_journey_html(data, out, title=ctx.manifest.get("locationId", ""))
    s = data["stats"]
    print(
        f"jornada: {len(data['criacao'])} entradas na criação, "
        f"{len(data['anytime'])} eventos avulsos, "
        f"{s['workflows_alcancaveis']} workflows alcançáveis, {s['loops']} loops"
    )
    if data["truncated"]:
        print("atenção: árvore truncada (caps de profundidade/nós)", file=sys.stderr)
    print(f"abra no browser: {out}")
    return 0


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
    """ESCREVE workflow ao vivo passando pela validação das 18 regras.

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


def run_tui(args: argparse.Namespace) -> int:
    # lazy de propósito: o Textual é extra opcional (`[tui]`).
    try:
        from .tui.app import AutomasterApp
    except ImportError:
        print("a TUI precisa do Textual: pip install -e '.[tui]'", file=sys.stderr)
        return 1
    AutomasterApp(animacao=not args.sem_animacao).run()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="automaster-audit", description="Audita um dump de workflows GHL.")
    sub = parser.add_subparsers(required=True)
    p_audit = sub.add_parser("audit", help="audita uma pasta de dump")
    p_audit.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_audit.set_defaults(func=run_audit)

    p_graph = sub.add_parser("graph", help="gera grafo HTML interativo de conexões")
    p_graph.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_graph.add_argument("-o", "--output", type=Path, help="arquivo HTML de saída (default: <dump>/graph.html)")
    p_graph.set_defaults(func=run_graph)

    p_dash = sub.add_parser("dashboard", help="gera painel HTML (inventário de workflows/tags/fields)")
    p_dash.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_dash.add_argument("-o", "--output", type=Path, help="arquivo HTML de saída (default: <dump>/dashboard.html)")
    p_dash.set_defaults(func=run_dashboard)

    p_paths = sub.add_parser("paths", help="enumera caminhos de execução por workflow (Markdown)")
    p_paths.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_paths.add_argument("-o", "--output", type=Path, help="arquivo MD de saída (default: <dump>/paths.md)")
    p_paths.set_defaults(func=run_paths)

    p_vc = sub.add_parser("verify-contracts", help="roda contratos de teste contra o dump (PASS/FAIL/AMBIGUOUS)")
    p_vc.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_vc.add_argument(
        "--contracts", type=Path, default=Path("contracts"), help="dir dos contratos *.json (default: contracts/)"
    )
    p_vc.set_defaults(func=run_verify_contracts)

    p_val = sub.add_parser("validation", help="gera página HTML das 3 camadas de validação")
    p_val.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_val.add_argument("-o", "--output", type=Path, help="arquivo HTML de saída (default: <dump>/validation.html)")
    p_val.add_argument(
        "--contracts",
        type=Path,
        default=Path("contracts"),
        help="dir dos contratos *.json (default: contracts/; ausente → camada 3 indisponível)",
    )
    p_val.set_defaults(func=run_validation)

    p_journey = sub.add_parser("journey", help="gera árvore de jornada do contato (HTML)")
    p_journey.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_journey.add_argument(
        "--max-depth",
        type=int,
        default=DEFAULT_MAX_DEPTH,
        help=f"níveis máx. de cascata entre workflows (default: {DEFAULT_MAX_DEPTH})",
    )
    p_journey.add_argument(
        "--max-nodes",
        type=int,
        default=DEFAULT_MAX_NODES,
        help=f"nós máx. por raiz antes de truncar (default: {DEFAULT_MAX_NODES})",
    )
    p_journey.add_argument("-o", "--output", type=Path, help="arquivo HTML de saída (default: <dump>/journey.html)")
    p_journey.set_defaults(func=run_journey)

    p_diff = sub.add_parser("diff", help="compara dois dumps da mesma subconta (Markdown)")
    p_diff.add_argument("antes", type=Path, help="pasta do dump mais antigo")
    p_diff.add_argument("depois", type=Path, help="pasta do dump mais recente")
    p_diff.add_argument("-o", "--output", type=Path, help="arquivo MD de saída (default: <depois>/diff.md)")
    p_diff.set_defaults(func=run_diff)

    p_we = sub.add_parser(
        "workflow-editar", help="ESCREVE workflow ao vivo com a validação das 18 regras (a guarda da tool MCP)"
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

    p_tui = sub.add_parser("tui", help="navega pelos dumps no terminal (extra [tui])")
    p_tui.add_argument("--sem-animacao", action="store_true", help="desliga as animações")
    p_tui.set_defaults(func=run_tui)
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
            "graph",
            "dashboard",
            "paths",
            "verify-contracts",
            "validation",
            "journey",
            "diff",
            "workflow-editar",
            "tui",
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
