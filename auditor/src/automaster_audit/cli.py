"""CLI do auditor: `automaster-audit <pasta-do-dump>`."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import rules
from .finding import ERROR, INFO, WARN
from .loader import DumpError, load_dump
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="automaster-audit", description="Audita um dump de workflows GHL.")
    sub = parser.add_subparsers(required=True)
    p_audit = sub.add_parser("audit", help="audita uma pasta de dump")
    p_audit.add_argument("dump_path", type=Path, help="caminho da pasta de dump")
    p_audit.set_defaults(func=run_audit)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    # atalho: se o 1º argumento for um caminho existente, assume subcomando 'audit'
    raw = list(sys.argv[1:] if argv is None else argv)
    if raw and raw[0] not in ("audit", "-h", "--help") and Path(raw[0]).exists():
        raw = ["audit", *raw]
    args = parser.parse_args(raw)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
