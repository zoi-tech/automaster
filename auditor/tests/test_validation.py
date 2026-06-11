"""Testes do validation.html: agregação das 3 camadas + render Tron auto-contido."""
import json

from automaster_audit.cli import build_parser, run_validation
from automaster_audit.loader import load_dump
from automaster_audit.validation import build_validation
from automaster_audit.validation_html import write_validation_html
from conftest import wf

# if_else com 2 ramos (shape de test_enumerate_paths) + tag quebrada (ERROR camada 1)
BRANCH_STEPS = [
    {"id": "c", "type": "if_else", "name": "Cond",
     "attributes": {"branches": [{"id": "b1", "name": "VIP"}]}, "next": ["b1", "b2"]},
    {"id": "b1", "type": "if_else", "name": "VIP", "parent": "c", "attributes": {"if": []}, "next": "a1"},
    {"id": "b2", "type": "if_else", "name": "Else", "parent": "c", "attributes": {"else": []}, "next": "a2"},
    {"id": "a1", "type": "add_contact_tag", "name": "Add", "parent": "b1",
     "attributes": {"tags": ["fantasma"]}},
    {"id": "a2", "type": "sms", "name": "SMS Else", "parent": "b2"},
]

# find_opportunity → criar oportunidade (shape de test_contract, simulável)
OPP_STEPS = [
    {"id": "f", "type": "find_opportunity", "name": "Find", "attributes": {}, "next": ["t1", "t2"]},
    {"id": "t1", "type": "transition", "name": "Opportunity Found", "parent": "f"},
    {"id": "t2", "type": "transition", "name": "Opportunity Not Found", "parent": "f", "next": "a1"},
    {"id": "a1", "type": "internal_create_opportunity", "name": "Criar", "parent": "t2", "attributes": {}},
]


def test_build_validation_counts_and_tree(make_dump):
    ctx = load_dump(make_dump(workflows=[wf(steps=BRANCH_STEPS)], tags=[]))
    d = build_validation(ctx)
    # camada 1: tag "fantasma" não existe → broken_tag_ref ERROR; counts batem com achados
    c1 = d["camada1"]
    assert any(a["rule"] == "broken_tag_ref" and a["severity"] == "ERROR" for a in c1["achados"])
    for sev in ("ERROR", "WARN", "INFO"):
        assert c1["counts"][sev] == sum(1 for a in c1["achados"] if a["severity"] == sev)
    # ordenado ERROR → WARN → INFO
    ordem = {"ERROR": 0, "WARN": 1, "INFO": 2}
    sevs = [ordem[a["severity"]] for a in c1["achados"]]
    assert sevs == sorted(sevs)
    # camada 2: 2 caminhos (VIP/ELSE), sem truncamento, rótulos legíveis na árvore
    c2 = d["camada2"]
    assert c2["total_paths"] == 2 and c2["truncated"] == 0
    w = c2["workflows"][0]
    assert w["n_paths"] == 2 and w["truncated"] is False
    texto = json.dumps(w["tree"], ensure_ascii=False)
    assert "VIP" in texto and "ELSE" in texto and "add tag fantasma" in texto and "[fim]" in texto
    # camada 3: sem diretório de contratos → indisponível, sem erro
    assert d["camada3"] == {"disponivel": False}
    # meta
    assert d["meta"]["locationId"] == "TESTLOC"
    assert d["meta"]["n_workflows"] == 1


def test_build_validation_camada3_com_contratos(make_dump, tmp_path):
    ctx = load_dump(make_dump(workflows=[wf(steps=OPP_STEPS)]))
    cdir = tmp_path / "contracts"
    cdir.mkdir()
    (cdir / "c1.json").write_text(json.dumps({
        "workflow": "wf1",
        "casos": [{"nome": "sem oportunidade → cria",
                   "dado": {"oportunidade_encontrada": False},
                   "espera": {"acoes_contem": ["criar oportunidade"], "termina_em": "exit"}}],
    }, ensure_ascii=False), encoding="utf-8")
    c3 = build_validation(ctx, contracts_dir=cdir)["camada3"]
    assert c3["disponivel"] is True
    assert c3["counts"] == {"PASS": 1, "FAIL": 0, "AMBIGUOUS": 0}
    assert c3["casos"][0]["status"] == "PASS"


def test_build_validation_camada3_contrato_quebrado(make_dump, tmp_path):
    ctx = load_dump(make_dump(workflows=[wf(steps=OPP_STEPS)]))
    cdir = tmp_path / "contracts"
    cdir.mkdir()
    (cdir / "quebrado.json").write_text("{not json", encoding="utf-8")
    c3 = build_validation(ctx, contracts_dir=cdir)["camada3"]
    assert c3["disponivel"] is False
    assert "quebrado.json" in c3["erro"]


def test_validation_html_safe_and_selfcontained(make_dump, tmp_path):
    nome = "</script><img src=x onerror=alert(1)>"
    path = make_dump(workflows=[wf(name=nome, steps=BRANCH_STEPS)], tags=[])
    data = build_validation(load_dump(path))
    out = write_validation_html(data, tmp_path / "v.html", title="T")
    html = out.read_text(encoding="utf-8")
    assert "</script><img" not in html
    assert "&lt;img src=x onerror=alert(1)&gt;" in html
    # auto-contido: sem recurso externo; fonte vai como data: URI
    assert 'src="http' not in html and 'href="http' not in html and "@import" not in html
    assert "unpkg" not in html
    assert "Validação" in html and "CAMADA 2" in html


def test_cli_validation_subcommand(make_dump, tmp_path, capsys):
    path = make_dump(workflows=[wf(steps=BRANCH_STEPS)], tags=[])
    out = tmp_path / "validation.html"
    assert build_parser().parse_args(["validation", str(path)]).contracts.name == "contracts"  # default
    args = build_parser().parse_args(
        ["validation", str(path), "-o", str(out), "--contracts", str(tmp_path / "nao-existe")])
    assert args.func is run_validation
    assert run_validation(args) == 0  # relatório, não gate
    assert out.exists()
    cap = capsys.readouterr().out
    assert "camada 1:" in cap and "camada 2:" in cap and "nenhum contrato" in cap
    assert "abra no browser:" in cap
