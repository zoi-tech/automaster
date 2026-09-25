"""Contrato e teto das seis tools offline do servidor MCP."""

import json
import shutil
import subprocess
from collections import Counter

import pytest
from conftest import tag_cond, trig, wf

from automaster_audit import mcp_server as srv
from automaster_audit.mcp import base as mcp_base
from automaster_audit.mcp import conversas as mcp_conversas


def test_run_extractor_builds_cmd_and_parses_last_line(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True)
    tsx.write_text("")
    monkeypatch.setattr(mcp_base, "EXTRACTOR_DIR", tmp_path)
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        seen["env"] = kw["env"]
        return subprocess.CompletedProcess(cmd, 0, stdout='ruído\n{"ok": 1}\n', stderr="")

    monkeypatch.setattr(mcp_base.subprocess, "run", fake_run)
    assert srv._run_extractor("contato-editar", "-l", "L", "--json") == {"ok": 1}
    assert seen["cmd"][1:] == ["src/cli.ts", "contato-editar", "-l", "L", "--json"]
    assert seen["env"]["AUTOMASTER_DUMPS"]


def test_run_extractor_failure_carries_stderr(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True)
    tsx.write_text("")
    monkeypatch.setattr(mcp_base, "EXTRACTOR_DIR", tmp_path)
    monkeypatch.setattr(
        mcp_base.subprocess,
        "run",
        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr="snapshot: /x/y.json\nHTTP 403"),
    )
    with pytest.raises(srv.ToolError, match="snapshot: /x/y.json"):
        srv._run_extractor("contato-editar")


def test_run_extractor_failure_keeps_snapshot_head_despite_long_stderr(monkeypatch, tmp_path):
    """O `snapshot:` sai ANTES das escritas: não pode sumir na cauda de um stack trace longo."""
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True)
    tsx.write_text("")
    monkeypatch.setattr(mcp_base, "EXTRACTOR_DIR", tmp_path)
    err = (
        "Capturando tokens (faça login na janela do Chrome, se pedido)...\n"
        "401 — recapturando tokens...\n401 — recapturando tokens...\nsnapshot: /x/y.json\n"
        + "\n".join(f"    at frame{i} ................................" for i in range(200))
    )
    monkeypatch.setattr(
        mcp_base.subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr=err)
    )
    with pytest.raises(srv.ToolError, match="snapshot: /x/y.json") as e:
        srv._run_extractor("contato-editar")
    assert "frame199" in str(e.value) and "tool `contato`" in str(e.value)


def test_run_extractor_timeout_becomes_tool_error(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True)
    tsx.write_text("")
    monkeypatch.setattr(mcp_base, "EXTRACTOR_DIR", tmp_path)

    def boom(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 600, stderr="snapshot: /x/y.json\n")

    monkeypatch.setattr(mcp_base.subprocess, "run", boom)
    with pytest.raises(srv.ToolError, match="snapshot: /x/y.json") as e:
        srv._run_extractor("contato-editar")
    assert "tool `contato`" in str(e.value)


LOC = "TESTLOC"


@pytest.fixture
def root(make_dump, tmp_path, monkeypatch):
    """Monta <root>/<loc>/<snapshot>/ a partir do make_dump e aponta o servidor pra lá."""

    def _build(snapshot="2026-06-10_0000", **kw):
        d = make_dump(**kw)
        dest = tmp_path / "root" / LOC / snapshot
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(d), str(dest))
        monkeypatch.setenv("AUTOMASTER_DUMPS", str(tmp_path / "root"))
        srv._ctx.cache_clear()
        return dest

    return _build


def _steps_tag(tag):
    return [{"type": "add_contact_tag", "name": "Add", "attributes": {"tags": [tag]}}]


def test_dumps_lists_snapshots(root):
    root(snapshot="2026-06-01_0000")
    root(snapshot="2026-06-10_0000", workflows=[wf()])
    out = srv.dumps()
    assert out[0]["loc"] == LOC
    assert out[0]["snapshots"] == ["2026-06-10_0000", "2026-06-01_0000"]
    assert out[0]["extractedAt"] == "2026-06-10T00:00:00+00:00"


def test_every_tool_carries_snapshot_block(root):
    root(workflows=[wf()], tags=["x"])
    for out in (
        srv.inventario(LOC),
        srv.workflow(LOC, "wf1"),
        srv.achados(LOC),
        srv.buscar(LOC, "x"),
        srv.jornada(LOC),
    ):
        assert set(out["_snapshot"]) == {"snapshot", "extractedAt", "idade_dias"}
        assert isinstance(out["_snapshot"]["idade_dias"], int)


def test_unknown_loc_is_error(root):
    root()
    with pytest.raises(srv.ToolError):
        srv.inventario("NOPE")


def test_inventario_default_is_summary_only(root):
    root(workflows=[wf(steps=_steps_tag("a"))], tags=["a", "b"])
    out = srv.inventario(LOC)
    assert set(out) == {"summary", "_snapshot"}
    assert out["summary"]["tags_orphan"] == 1
    fatia = srv.inventario(LOC, "tags")
    assert [t["name"] for t in fatia["tags"]] == ["a", "b"]
    with pytest.raises(srv.ToolError):
        srv.inventario(LOC, "nada")


def test_workflow_meta_paths_and_findings(root):
    steps = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}]
    root(workflows=[wf(steps=steps)], tags=[])
    out = srv.workflow(LOC, "wf1")
    assert out["meta"]["name"] == "[Solar] Compra → Boas-vindas"
    assert out["meta"]["n_steps"] == 1
    assert "add tag" in out["caminhos"] and out["caminhos_truncado"] is False
    assert [f["rule"] for f in out["achados"]] == ["broken_tag_ref"]
    with pytest.raises(srv.ToolError):
        srv.workflow(LOC, "nope")


def test_workflow_paths_have_ceiling(root, monkeypatch):
    # cadeia de 60 if_else = muitos caminhos; o teto corta e avisa
    steps = []
    for i in range(40):
        b = {
            "id": f"b{i}",
            "type": "if_else",
            "name": f"If{i}",
            "attributes": {"branches": [{"id": f"y{i}", "name": "Sim"}, {"id": f"n{i}", "name": "Não"}]},
        }
        steps.append(b)
    root(workflows=[wf(steps=steps)])
    monkeypatch.setattr(mcp_base, "PATHS_MAX_CHARS", 200)
    out = srv.workflow(LOC, "wf1")
    assert out["caminhos_truncado"] is True
    assert len(out["caminhos"]) <= 260


def test_achados_groups_and_keeps_counts(root):
    steps = [
        {"id": f"s{i}", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}} for i in range(3)
    ]
    root(workflows=[wf(steps=steps)], tags=[])
    out = srv.achados(LOC, "ERROR")
    assert out["counts"]["ERROR"] == 3 and "INFO" in out["counts"]
    grp = [a for a in out["achados"] if a["rule"] == "broken_tag_ref"]
    assert len(grp) == 1 and grp[0]["n"] == 3
    assert all(a["severity"] == "ERROR" for a in out["achados"])


def test_buscar_returns_papel(root):
    trig = {
        "id": "t1",
        "name": "Contact Tag",
        "type": "contact_tag",
        "conditions": [{"field": "tagsAdded", "operator": "index-of-true", "value": "gatilho"}],
    }
    root(
        workflows=[wf(name="Fluxo Gatilho", triggers=[trig], steps=_steps_tag("outra"))],
        tags=["gatilho", "outra"],
        fields=[{"id": "F1", "name": "Gatilho de campo"}],
    )
    out = srv.buscar(LOC, "gatilho")
    tags = {t["name"]: t for t in out["tags"]}
    assert tags["gatilho"]["papeis"] == ["dispara"] and tags["gatilho"]["orphan"] is False
    assert out["workflows"][0]["name"] == "Fluxo Gatilho"
    assert out["fields"][0]["name"] == "Gatilho de campo"
    assert "outra" not in tags


def test_jornada_one_level_never_full_subtree(root):
    trig = {
        "id": "t1",
        "name": "Novo",
        "type": "contact_created",
        "conditions": [],
        "active": True,
        "workflow_id": "wf1",
        "actions": [{"workflow_id": "wf1", "type": "add_to_workflow"}],
    }
    steps = [
        {"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["a"]}, "next": ["s2"]},
        {"id": "s2", "type": "sms", "name": "SMS", "attributes": {}, "parent": "s1"},
    ]
    root(workflows=[wf(triggers=[trig], steps=steps)], tags=["a"])
    raiz = srv.jornada(LOC)
    assert set(raiz) == {"criacao", "anytime", "_snapshot"}
    n0 = raiz["criacao"][0]
    assert "children" not in json.dumps(raiz)
    assert n0["n_filhos"] == 1
    nivel = srv.jornada(LOC, [0])
    assert nivel["no"]["label"] == "Contato criado" and nivel["filhos"][0]["kind"] == "workflow"
    assert "children" not in json.dumps(nivel)
    fundo = srv.jornada(LOC, [0, 0], profundidade=2)
    assert "filhos" in fundo["filhos"][0]
    with pytest.raises(srv.ToolError):
        srv.jornada(LOC, [9])


def test_rpc_roundtrip(root, capsys):
    root(workflows=[wf()])
    req = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "inventario", "arguments": {"loc": LOC}},
        },
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "inventario", "arguments": {"loc": "NOPE"}},
        },
    ]
    resps = [srv.handle(r) for r in req]
    assert resps[0]["result"]["protocolVersion"]
    assert {t["name"] for t in resps[1]["result"]["tools"]} >= {
        "dumps",
        "inventario",
        "workflow",
        "achados",
        "buscar",
        "jornada",
    }
    body = json.loads(resps[2]["result"]["content"][0]["text"])
    assert body["summary"]["workflows"] == 1
    assert resps[3]["result"]["isError"] is True


def _ev(i):
    return {
        "id": f"e{i}",
        "type": "TAG",
        "createdAt": f"2026-06-{10 - i:02d}T00:00:00.000Z",
        "sourceId": "wf1",
        "sourceWorkflowName": "Boas-vindas",
    }


def test_contato_returns_events_and_snapshot(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_timeline", lambda loc, id, days: {"events": [_ev(0), _ev(1)]})
    out = srv.contato(LOC, "c1")
    assert [e["id"] for e in out["eventos"]] == ["e0", "e1"]
    assert out["truncado"] is False and "_snapshot" in out


def test_contato_drops_noise_keys(root, monkeypatch):
    root(workflows=[wf()])
    ev = {
        **_ev(0),
        "traceId": "t",
        "commonPrimaryId": "c",
        "_id": "c",
        "shardId": "s",
        "secondaryId": "x",
        "apiVersion": "v",
        "chPublished": True,
        "externalChange": True,
    }
    monkeypatch.setattr(mcp_base, "_run_timeline", lambda loc, id, days: {"events": [ev]})
    got = srv.contato(LOC, "c1")["eventos"][0]
    assert set(got) == set(_ev(0))


def test_contato_ceiling_pages_by_time(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_timeline", lambda loc, id, days: {"events": [_ev(i) for i in range(9)]})
    monkeypatch.setattr(mcp_base, "CONTATO_MAX_CHARS", 400)
    out = srv.contato(LOC, "c1")
    assert out["truncado"] is True and len(out["eventos"]) < 9
    assert out["proximo_ate"] == out["eventos"][-1]["createdAt"]
    page2 = srv.contato(LOC, "c1", ate=out["proximo_ate"])
    assert page2["eventos"][0]["createdAt"] < out["proximo_ate"]


def test_contato_without_setup_teaches(root, monkeypatch, tmp_path):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "EXTRACTOR_DIR", tmp_path / "nao-existe")
    with pytest.raises(srv.ToolError, match="automaster-extract"):
        srv.contato(LOC, "c1")


def test_editar_calls_extractor_and_lists_triggered_workflows(root, monkeypatch):
    root(
        workflows=[
            wf(id="a", name="Tag quente", triggers=[trig("contact_tag", "a", conditions=[tag_cond("quente")])]),
            wf(id="b", name="Campo mudou", triggers=[trig("contact_changed", "b")]),
        ],
        tags=["quente"],
    )
    seen = {}
    monkeypatch.setattr(
        mcp_base,
        "_run_extractor",
        lambda *a: (
            seen.setdefault("args", a)
            and {"id": "c1", "snapshot": "/mcp_base.json", "antes": {}, "depois": {}, "mudancas": {}}
        ),
    )
    out = srv.editar(LOC, "c1", set={"phone": "+55"}, tags_adicionar=["quente"])
    assert seen["args"][:5] == ("contato-editar", "-l", LOC, "-i", "c1")
    assert "--set" in seen["args"] and "phone=+55" in seen["args"] and "+quente" in seen["args"]
    assert {d["workflow"] for d in out["dispara"]} == {"a", "b"}
    assert out["snapshot"] == "/mcp_base.json" and "_snapshot" in out


def _fake_extractor(monkeypatch):
    monkeypatch.setattr(
        mcp_base,
        "_run_extractor",
        lambda *a: {"id": "c1", "snapshot": "/mcp_base.json", "antes": {}, "depois": {}, "mudancas": {}},
    )


def test_editar_tags_remover_dispara(root, monkeypatch):
    """Remoção de tag também avisa: trigger contact_tag com condição tagsRemoved."""
    rem = {
        "operator": "index-of-true",
        "id": "tag-removed",
        "value": "quente",
        "title": "Tag Removed",
        "type": "select",
        "field": "tagsRemoved",
    }
    root(
        workflows=[
            wf(id="a", name="Saiu quente", triggers=[trig("contact_tag", "a", conditions=[rem])]),
            wf(
                id="b",
                name="Entrou quente",
                triggers=[trig("contact_tag", "b", conditions=[tag_cond("quente")], tid="tr2")],
            ),
        ],
        tags=["quente"],
    )
    _fake_extractor(monkeypatch)
    out = srv.editar(LOC, "c1", tags_remover=["quente"])
    assert {d["workflow"] for d in out["dispara"]} == {"a"}


def test_editar_ignores_draft_workflows(root, monkeypatch):
    root(
        workflows=[
            wf(
                id="a",
                name="Rascunho",
                status="draft",
                triggers=[trig("contact_tag", "a", conditions=[tag_cond("quente")])],
            )
        ],
        tags=["quente"],
    )
    _fake_extractor(monkeypatch)
    assert srv.editar(LOC, "c1", tags_adicionar=["quente"])["dispara"] == []


def test_editar_requires_something_to_change(root):
    root(workflows=[wf()])
    with pytest.raises(srv.ToolError, match="set"):
        srv.editar(LOC, "c1")


def test_conversas_trunca_corpo_e_marca_truncado(root, monkeypatch):
    root(workflows=[wf()])
    longo = "x" * (mcp_conversas.CONVERSAS_CORPO + 50)
    monkeypatch.setattr(
        mcp_base,
        "_run_extractor",
        lambda *a: {
            "contactId": "c1",
            "conversationId": "k1",
            "maisPaginas": True,
            "mensagens": [{"id": "m1", "tipo": "EMAIL", "direcao": "outbound", "origem": "workflow", "corpo": longo}],
        },
    )
    out = srv.conversas(LOC, "c1")
    m = out["mensagens"][0]
    assert len(m["corpo"]) == mcp_conversas.CONVERSAS_CORPO and m["corpo_truncado"]
    assert m["origem"] == "workflow"
    assert out["truncado"] is True  # maisPaginas


def test_conversas_passa_atividades_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: seen.setdefault("args", a) and {} or {"mensagens": []})
    srv.conversas(LOC, "c1", max=5, atividades=True)
    assert seen["args"][:6] == ("conversas", "-l", LOC, "-i", "c1", "--max")
    assert "--atividades" in seen["args"]


def test_enviar_externo_sem_confirmo_e_recusado(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.enviar(LOC, "c1", "SMS", "oi")
    assert "confirmo=true" in str(e.value)


def test_enviar_interno_dispensa_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(
        mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or {"enviado": True, "messageId": "m1"}
    )
    out = srv.enviar(LOC, "c1", "internalcomment", "nota")
    assert out["enviado"] and "--tipo" in seen["args"]
    assert seen["args"][seen["args"].index("--tipo") + 1] == "InternalComment"


def test_enviar_email_exige_assunto(root):
    root(workflows=[wf()])
    with pytest.raises(srv.ToolError):
        srv.enviar(LOC, "c1", "Email", "corpo", confirmo=True)


def test_conversa_acao_apagar_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.conversa_acao(LOC, "apagar", id="c1")
    assert "conversa INTEIRA" in str(e.value)


def test_conversa_acao_mensagem_exige_messageid(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError):
        srv.conversa_acao(LOC, "reenviar")


def test_conversa_acao_marca_lida(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or {"ok": True})
    srv.conversa_acao(LOC, "lida", id="c1")
    assert seen["args"][:3] == ("conversas-marcar", "-l", LOC)
    assert "--confirmo" not in seen["args"]


def test_rascunho_apagar_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError):
        srv.conversa_acao(LOC, "rascunho-apagar", id="c1")


def test_enviar_agendado_recusa_nota_interna(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.enviar(LOC, "c1", "InternalComment", "nota", quando="2026-12-01T10:00:00Z")
    assert "sai na hora" in str(e.value)


def test_conversas_repassa_filtros(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or {"mensagens": []})
    srv.conversas(LOC, "c1", tipo="TYPE_EMAIL", busca="oi", email="e1")
    for flag, valor in (("--tipo", "TYPE_EMAIL"), ("--busca", "oi"), ("--email", "e1")):
        assert seen["args"][seen["args"].index(flag) + 1] == valor


def test_anexar_recusa_caminho_invalido(root, tmp_path, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError):
        srv.conversa_acao(LOC, "anexar", id="c1", arquivos=[])
    with pytest.raises(srv.ToolError) as e:
        srv.conversa_acao(LOC, "anexar", id="c1", arquivos=[str(tmp_path / "nao-existe.png")])
    assert "não existe" in str(e.value)
    with pytest.raises(srv.ToolError) as e:
        srv.conversa_acao(LOC, "anexar", id="c1", arquivos=[str(tmp_path)])
    assert "não é arquivo" in str(e.value)


def test_anexar_recusa_arquivo_grande(root, tmp_path, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    monkeypatch.setattr(mcp_conversas, "MAX_ANEXO_BYTES", 10)
    f = tmp_path / "grande.bin"
    f.write_bytes(b"x" * 11)
    with pytest.raises(srv.ToolError) as e:
        srv.conversa_acao(LOC, "anexar", id="c1", arquivos=[str(f)])
    assert "teto" in str(e.value)


def test_anexar_passa_argumentos_ao_extractor(root, tmp_path, monkeypatch):
    root(workflows=[wf()])
    f = tmp_path / "a.png"
    f.write_bytes(b"png")
    seen = {}
    monkeypatch.setattr(
        mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or {"subido": True, "urls": ["http://x/a.png"]}
    )
    out = srv.conversa_acao(LOC, "anexar", id="c1", arquivos=[str(f)], conversa="k1", grupo=True)
    assert out["urls"] == ["http://x/a.png"]
    args = seen["args"]
    assert args[:5] == ("conversas-anexar", "-l", LOC, "-i", "c1")
    assert args[args.index("--arquivo") + 1] == str(f)
    assert args[args.index("--conversa") + 1] == "k1"
    assert "--grupo" in args


def test_whatsapp_enviar_exige_confirmo_e_um_modo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.whatsapp_enviar(LOC, "c1", template="t1")
    assert "confirmo=true" in str(e.value)
    with pytest.raises(srv.ToolError):  # nem template nem flow
        srv.whatsapp_enviar(LOC, "c1", confirmo=True)
    with pytest.raises(srv.ToolError):  # os dois
        srv.whatsapp_enviar(LOC, "c1", template="t1", flow="f1", confirmo=True)
    with pytest.raises(srv.ToolError) as e:
        srv.whatsapp_enviar(LOC, "c1", flow="f1", confirmo=True)
    assert "corpo e cta" in str(e.value)


def test_whatsapp_leitura_passa_operacao(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or [{"id": "t1"}])
    out = srv.whatsapp(LOC, "templates", template="t1")
    assert out["resultado"] == [{"id": "t1"}]
    assert seen["args"][:5] == ("whatsapp", "-l", LOC, "-o", "templates")
    assert seen["args"][seen["args"].index("--template") + 1] == "t1"
    with pytest.raises(srv.ToolError):
        srv.whatsapp(LOC, "inventado")


def test_config_escrita_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or {})
    with pytest.raises(srv.ToolError) as e:
        srv.config(LOC, "sla-gravar", corpo={"x": 1})
    assert "confirmo=true" in str(e.value)
    srv.config(LOC, "sla")  # leitura passa sem confirmo
    assert "--confirmo" not in seen["args"]
    srv.config(LOC, "sla-gravar", corpo={"x": 1}, confirmo=True)
    assert "--confirmo" in seen["args"]
    assert seen["args"][seen["args"].index("--corpo") + 1] == '{"x": 1}'


def test_grupo_escrita_exige_confirmo_leitura_nao(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or {})
    with pytest.raises(srv.ToolError):
        srv.grupo(LOC, "mensagem", corpo={"a": 1})
    srv.grupo(LOC, "interno-participantes", conversa="k1", usuarios=["u1", "u2"], desde="-1")
    args = seen["args"]
    assert "--confirmo" not in args
    assert args.count("--usuario") == 2
    assert args[args.index("--desde") + 1] == "-1"
    with pytest.raises(srv.ToolError):
        srv.grupo(LOC, "inventado")


def test_oportunidades_recusa_operacao_invalida(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidades(LOC, o="inventar")
    assert "inventar" in str(e.value)


def test_oportunidades_ver_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidades(LOC, o="ver")
    assert "id" in str(e.value)


def test_oportunidades_buscar_passa_termo_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"ok": True})
    r = srv.oportunidades(LOC, o="buscar", termo="teto solar")
    assert r["resultado"] == {"ok": True}
    assert "--termo" in visto["args"] and "teto solar" in visto["args"]


def test_oportunidade_acao_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="apagar", id="o1")
    assert "confirmo=true" in str(e.value)


def test_oportunidade_acao_recusa_trocar_contato(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="editar", id="o1", contato="c9", confirmo=True)
    assert "contato" in str(e.value)


def test_oportunidade_acao_criar_exige_os_tres_campos(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="criar", nome="Teto solar", confirmo=True)
    assert "pipeline" in str(e.value)


def test_oportunidade_acao_mover_chama_o_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    r = srv.oportunidade_acao(LOC, acao="mover", id="o1", estagio="s2", confirmo=True)
    assert r["aplicado"] is True
    assert "--estagio" in visto["args"] and "s2" in visto["args"]


def test_pipeline_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.pipeline(LOC, acao="apagar", id="p1")
    assert "confirmo=true" in str(e.value)


def test_pipeline_editar_exige_lista_de_estagios(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.pipeline(LOC, acao="editar", id="p1", confirmo=True)
    assert "estagios" in str(e.value)


def test_pipeline_serializa_estagios_como_json(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    srv.pipeline(LOC, acao="criar", nome="zz", estagios=[{"name": "Novo"}], confirmo=True)
    assert '[{"name": "Novo"}]' in visto["args"]


def test_pipeline_passa_apagar_com_cards(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    srv.pipeline(
        LOC, acao="editar", id="p1", estagios=[{"id": "s1", "name": "A"}], confirmo=True, apagar_com_cards=True
    )
    assert "--apagar-com-cards" in visto["args"]


def test_oportunidades_passa_pagina(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"ok": True})
    srv.oportunidades(LOC, o="listar", pagina=3)
    assert "--pagina" in visto["args"] and "3" in visto["args"]


def test_oportunidade_acao_serializa_campos_e_previsao(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    srv.oportunidade_acao(
        LOC,
        acao="editar",
        id="o1",
        fechamento="2026-12-01",
        probabilidade=40,
        campos=[{"id": "f1", "fieldValue": "x"}],
        confirmo=True,
    )
    assert "2026-12-01" in visto["args"]
    assert '[{"id": "f1", "fieldValue": "x"}]' in visto["args"]


def test_agenda_recusa_operacao_invalida(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inválido"):
        srv.agenda(LOC, o="inventar")


def test_agenda_eventos_exige_periodo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inicio"):
        srv.agenda(LOC, o="eventos", calendario="c1")


def test_agenda_eventos_passa_periodo_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"events": []})
    r = srv.agenda(
        LOC, o="eventos", calendario="c1", inicio="2026-10-01T00:00:00-03:00", fim="2026-10-08T00:00:00-03:00"
    )
    assert r["resultado"] == {"events": []}
    assert "--inicio" in visto["args"] and "2026-10-01T00:00:00-03:00" in visto["args"]
    assert "--calendario" in visto["args"] and "c1" in visto["args"]


def test_agenda_acao_recusa_sem_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.agenda_acao(LOC, acao="cancelar", id="e1")


def test_agenda_acao_marcar_exige_situacao(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="situacao"):
        srv.agenda_acao(
            LOC, acao="marcar", calendario="c1", contato="k1", inicio="2026-10-02T14:00:00-03:00", confirmo=True
        )


def test_agenda_acao_recusa_situacao_fora_do_enum(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="remarcado"):
        srv.agenda_acao(LOC, acao="situacao", id="e1", situacao="remarcado", confirmo=True)


def test_agenda_acao_repeticao_exige_dono(root, monkeypatch):
    """422 ao vivo: "A team member needs to be selected. assignedUserId is missing"."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="dono"):
        srv.agenda_acao(
            LOC,
            acao="marcar",
            calendario="c1",
            contato="k1",
            inicio="2026-10-02T14:00:00-03:00",
            situacao="confirmed",
            repeticao="FREQ=WEEKLY;COUNT=3",
            confirmo=True,
        )


def test_agenda_acao_remarcar_exige_inicio(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inicio"):
        srv.agenda_acao(LOC, acao="remarcar", id="e1", alvo="instancia", confirmo=True)


def test_agenda_acao_situacao_exige_situacao(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="situacao"):
        srv.agenda_acao(LOC, acao="situacao", id="e1", confirmo=True)


def test_agenda_acao_remarcar_chama_o_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    r = srv.agenda_acao(
        LOC, acao="remarcar", id="e1", alvo="instancia", inicio="2026-10-03T15:00:00-03:00", confirmo=True
    )
    assert r["aplicado"] is True
    assert "--alvo" in visto["args"] and "instancia" in visto["args"]
    assert "--confirmo" in visto["args"]


def test_agenda_acao_bloquear_exige_periodo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inicio e fim"):
        srv.agenda_acao(LOC, acao="bloquear", dono="u1", inicio="2026-10-02T14:00:00-03:00", confirmo=True)


def test_agenda_acao_bloquear_recusa_contato_e_situacao(root, monkeypatch):
    """A rota de block-slots não aceita contactId nem appointmentStatus."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="contato nem situação"):
        srv.agenda_acao(
            LOC,
            acao="bloquear",
            dono="u1",
            contato="k1",
            inicio="2026-10-02T14:00:00-03:00",
            fim="2026-10-02T15:00:00-03:00",
            confirmo=True,
        )


def test_agenda_acao_bloquear_chama_o_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    r = srv.agenda_acao(
        LOC,
        acao="bloquear",
        dono="u1",
        inicio="2026-10-02T14:00:00-03:00",
        fim="2026-10-02T15:00:00-03:00",
        titulo="fora",
        confirmo=True,
    )
    assert r["aplicado"] is True
    assert "bloquear" in visto["args"] and "--confirmo" in visto["args"]
    assert "--titulo" in visto["args"] and "fora" in visto["args"]


def test_agenda_acao_bloqueio_editar_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="id"):
        srv.agenda_acao(LOC, acao="bloqueio-editar", inicio="2026-10-02T14:00:00-03:00", confirmo=True)


def test_agenda_acao_bloqueio_editar_exige_campos(root, monkeypatch):
    """bloqueio-editar monta o mesmo corpo de bloquear: campo ausente vira remoção no PUT."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inicio, fim e dono"):
        srv.agenda_acao(LOC, acao="bloqueio-editar", id="bs1", titulo="novo", confirmo=True)


def test_agenda_acao_bloqueio_recusa_calendario(root, monkeypatch):
    """400 ao vivo: "The calendar is not an event calendar."."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="calendario"):
        srv.agenda_acao(
            LOC,
            acao="bloquear",
            dono="u1",
            calendario="c1",
            inicio="2026-10-02T14:00:00-03:00",
            fim="2026-10-02T15:00:00-03:00",
            confirmo=True,
        )


def test_agenda_bloqueios_recusa_contato(root, monkeypatch):
    """listBlockedSlots não filtra por contato: bloqueio não tem contato."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="contato"):
        srv.agenda(
            LOC,
            o="bloqueios",
            calendario="c1",
            contato="k1",
            inicio="2026-10-02T14:00:00-03:00",
            fim="2026-10-02T15:00:00-03:00",
        )


def test_agenda_bloqueios_exige_periodo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inicio"):
        srv.agenda(LOC, o="bloqueios", calendario="c1")


def test_agenda_acao_bloquear_exige_dono(root, monkeypatch):
    """400 ao vivo com calendário comum: "The calendar is not an event calendar."."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="dono"):
        srv.agenda_acao(
            LOC,
            acao="bloquear",
            calendario="c1",
            inicio="2026-10-02T14:00:00-03:00",
            fim="2026-10-02T15:00:00-03:00",
            confirmo=True,
        )


def test_agenda_acao_forcar_exige_dono(root, monkeypatch):
    """422 ao vivo: "A team member needs to be selected. assignedUserId is missing"."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="dono"):
        srv.agenda_acao(
            LOC,
            acao="marcar",
            calendario="c1",
            contato="k1",
            inicio="2026-10-02T14:00:00-03:00",
            situacao="confirmed",
            forcar=True,
            confirmo=True,
        )


def test_agenda_acao_remarcar_forcar_exige_dono(root, monkeypatch):
    """remarcar também liga ignoreFreeSlotValidation com --forcar, mesmo 422 em potencial."""
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="dono"):
        srv.agenda_acao(LOC, acao="remarcar", id="ap1", inicio="2026-10-02T14:00:00-03:00", forcar=True, confirmo=True)


def test_formularios_recusa_operacao_invalida(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="inválido"):
        srv.formularios(LOC, o="inventar")


def test_formularios_recusa_tipo_invalido(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="tipo"):
        srv.formularios(LOC, tipo="planilha")


def test_formularios_detalhe_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="id"):
        srv.formularios(LOC, o="detalhe")


def test_formularios_passa_filtros_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: visto.update(args=a) or {"submissions": []})
    r = srv.formularios(LOC, o="submissoes", tipo="survey", formulario="S1", inicio="2026-09-01", limite=5)
    assert r["resultado"] == {"submissions": []}
    assert "--tipo" in visto["args"] and "survey" in visto["args"]
    assert "--formulario" in visto["args"] and "S1" in visto["args"]
    assert "--inicio" in visto["args"] and "2026-09-01" in visto["args"]
    assert "--limite" in visto["args"] and "5" in visto["args"]


def _extractor(monkeypatch, tmp_path, stdout, returncode=0):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True, exist_ok=True)
    tsx.write_text("")
    monkeypatch.setattr(mcp_base, "EXTRACTOR_DIR", tmp_path)
    monkeypatch.setattr(
        mcp_base.subprocess,
        "run",
        lambda cmd, **kw: subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr=""),
    )


def test_envelope_de_sucesso_e_desembrulhado(monkeypatch, tmp_path):
    _extractor(monkeypatch, tmp_path, 'ruído em stdout\n{"ok": true, "data": {"n": 3}}')
    assert srv._run_extractor("tags", "-l", "L1") == {"n": 3}


def test_envelope_de_erro_traz_code_e_so_avisa_de_escrita_que_saiu(monkeypatch, tmp_path):
    _extractor(
        monkeypatch,
        tmp_path,
        '{"ok": false, "error": {"code": "http_422", "message": "position obrigatório"},'
        ' "escrita": {"tentada": true, "rastros": ["/r/antes.json"]}}',
        returncode=1,
    )
    with pytest.raises(srv.ToolError) as e:
        srv._run_extractor("workflow-editar", "--confirmo")
    assert "http_422" in str(e.value) and "position obrigatório" in str(e.value)
    assert "parcialmente aplicada" in str(e.value) and "/r/antes.json" in str(e.value)


def test_previa_recusada_nao_acusa_escrita_parcial(monkeypatch, tmp_path):
    """Antes do envelope, `--confirmo` nos argumentos bastava para acusar — e prévia não grava."""
    _extractor(monkeypatch, tmp_path, '{"ok": false, "error": {"message": "prévia recusada"}}', returncode=1)
    with pytest.raises(srv.ToolError) as e:
        srv._run_extractor("workflow-editar", "--confirmo")
    assert "parcialmente aplicada" not in str(e.value)


def test_conversas_sem_contato_vira_busca_na_subconta(root, monkeypatch):
    """A busca da subconta era uma tool à parte (`conversas_buscar`); virou esta porta."""
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: seen.update(args=a) or {"conversas": []})
    srv.conversas(LOC, busca="boleto", max=5)
    assert seen["args"][:6] == ("conversas-buscar", "-l", LOC, "--termo", "boleto", "--max")


def test_conversas_sem_contato_e_sem_busca_diz_o_que_falta(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(mcp_base, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError, match="busca"):
        srv.conversas(LOC)


def _wf_achados(out):
    return {w["id"]: w["achados"] for w in out["workflows"]}


def test_inventario_workflows_conta_achados_so_no_workflow_quebrado(root):
    quebrado = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}]
    limpo = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["a"]}}]
    root(workflows=[wf(steps=quebrado), wf(id="wf2", name="[Solar] Outro → Limpo", steps=limpo)], tags=["a"])
    got = _wf_achados(srv.inventario(LOC, "workflows"))
    assert got["wf1"]["ERROR"] == 1
    assert got["wf2"]["ERROR"] == 0


def test_inventario_workflows_achados_bate_com_tool_achados(root):
    quebrado = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}]
    root(workflows=[wf(steps=quebrado), wf(id="wf2", name="[Solar] Outro → Limpo")], tags=[])
    esperado = {"wf1": Counter(), "wf2": Counter()}
    for a in srv.achados(LOC)["achados"]:
        if a["workflow_id"] in esperado:
            esperado[a["workflow_id"]][a["severity"]] += a["n"]
    got = _wf_achados(srv.inventario(LOC, "workflows"))
    for wid, c in esperado.items():
        assert got[wid] == {s: c[s] for s in ("ERROR", "WARN", "INFO")}


def test_inventario_workflows_zeros_presentes(root):
    root(workflows=[wf()], tags=[])
    for w in srv.inventario(LOC, "workflows")["workflows"]:
        assert set(w["achados"]) == {"ERROR", "WARN", "INFO"}
        assert all(isinstance(n, int) for n in w["achados"].values())


def test_inventario_workflows_achado_sem_workflow_id_nao_quebra(root, monkeypatch):
    from automaster_audit.finding import Finding

    quebrado = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}]
    root(workflows=[wf(steps=quebrado)], tags=[])
    real = mcp_base.rules.run_all
    monkeypatch.setattr(
        mcp_base.rules, "run_all", lambda ctx: [*real(ctx), Finding(rule="global", severity="ERROR", detail="x")]
    )
    mcp_base._findings.cache_clear()
    got = _wf_achados(srv.inventario(LOC, "workflows"))
    assert got["wf1"]["ERROR"] == 1


def test_inventario_workflows_repetido_nao_acumula_nem_suja_o_cache(root):
    quebrado = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}]
    root(workflows=[wf(steps=quebrado)], tags=[])
    primeira = _wf_achados(srv.inventario(LOC, "workflows"))
    segunda = _wf_achados(srv.inventario(LOC, "workflows"))
    assert primeira == segunda and segunda["wf1"]["ERROR"] == 1
    ctx, _ = mcp_base._load(LOC, None)
    assert all("achados" not in w for w in mcp_base._dash(str(ctx.path))["workflows"])
