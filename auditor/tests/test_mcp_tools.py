"""Contrato e teto das seis tools offline do servidor MCP."""
import json
import shutil
import subprocess

import pytest

from automaster_audit import mcp_server as srv
from conftest import tag_cond, trig, wf


def test_run_extractor_builds_cmd_and_parses_last_line(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True); tsx.write_text("")
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path)
    seen = {}
    def fake_run(cmd, **kw):
        seen["cmd"] = cmd; seen["env"] = kw["env"]
        return subprocess.CompletedProcess(cmd, 0, stdout='ruído\n{"ok": 1}\n', stderr="")
    monkeypatch.setattr(srv.subprocess, "run", fake_run)
    assert srv._run_extractor("contato-editar", "-l", "L", "--json") == {"ok": 1}
    assert seen["cmd"][1:] == ["src/cli.ts", "contato-editar", "-l", "L", "--json"]
    assert seen["env"]["AUTOMASTER_DUMPS"]


def test_run_extractor_failure_carries_stderr(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True); tsx.write_text("")
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path)
    monkeypatch.setattr(srv.subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr="snapshot: /x/y.json\nHTTP 403"))
    with pytest.raises(srv.ToolError, match="snapshot: /x/y.json"):
        srv._run_extractor("contato-editar")


def test_run_extractor_failure_keeps_snapshot_head_despite_long_stderr(monkeypatch, tmp_path):
    """O `snapshot:` sai ANTES das escritas: não pode sumir na cauda de um stack trace longo."""
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True); tsx.write_text("")
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path)
    err = ("Capturando tokens (faça login na janela do Chrome, se pedido)...\n"
           "401 — recapturando tokens...\n401 — recapturando tokens...\nsnapshot: /x/y.json\n"
           + "\n".join(f"    at frame{i} ................................" for i in range(200)))
    monkeypatch.setattr(srv.subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr=err))
    with pytest.raises(srv.ToolError, match="snapshot: /x/y.json") as e:
        srv._run_extractor("contato-editar")
    assert "frame199" in str(e.value) and "tool `contato`" in str(e.value)


def test_run_extractor_timeout_becomes_tool_error(monkeypatch, tmp_path):
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True); tsx.write_text("")
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path)
    def boom(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 600, stderr="snapshot: /x/y.json\n")
    monkeypatch.setattr(srv.subprocess, "run", boom)
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
    for out in (srv.inventario(LOC), srv.workflow(LOC, "wf1"), srv.achados(LOC),
                srv.buscar(LOC, "x"), srv.jornada(LOC)):
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
    steps, prev = [], None
    for i in range(40):
        b = {"id": f"b{i}", "type": "if_else", "name": f"If{i}", "attributes": {"branches": [
            {"id": f"y{i}", "name": "Sim"}, {"id": f"n{i}", "name": "Não"}]}}
        steps.append(b)
    root(workflows=[wf(steps=steps)])
    monkeypatch.setattr(srv, "PATHS_MAX_CHARS", 200)
    out = srv.workflow(LOC, "wf1")
    assert out["caminhos_truncado"] is True
    assert len(out["caminhos"]) <= 260


def test_achados_groups_and_keeps_counts(root):
    steps = [{"id": f"s{i}", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["sumida"]}}
             for i in range(3)]
    root(workflows=[wf(steps=steps)], tags=[])
    out = srv.achados(LOC, "ERROR")
    assert out["counts"]["ERROR"] == 3 and "INFO" in out["counts"]
    grp = [a for a in out["achados"] if a["rule"] == "broken_tag_ref"]
    assert len(grp) == 1 and grp[0]["n"] == 3
    assert all(a["severity"] == "ERROR" for a in out["achados"])


def test_buscar_returns_papel(root):
    trig = {"id": "t1", "name": "Contact Tag", "type": "contact_tag",
            "conditions": [{"field": "tagsAdded", "operator": "index-of-true", "value": "gatilho"}]}
    root(workflows=[wf(name="Fluxo Gatilho", triggers=[trig], steps=_steps_tag("outra"))],
         tags=["gatilho", "outra"], fields=[{"id": "F1", "name": "Gatilho de campo"}])
    out = srv.buscar(LOC, "gatilho")
    tags = {t["name"]: t for t in out["tags"]}
    assert tags["gatilho"]["papeis"] == ["dispara"] and tags["gatilho"]["orphan"] is False
    assert out["workflows"][0]["name"] == "Fluxo Gatilho"
    assert out["fields"][0]["name"] == "Gatilho de campo"
    assert "outra" not in tags


def test_jornada_one_level_never_full_subtree(root):
    trig = {"id": "t1", "name": "Novo", "type": "contact_created", "conditions": [], "active": True,
            "workflow_id": "wf1", "actions": [{"workflow_id": "wf1", "type": "add_to_workflow"}]}
    steps = [{"id": "s1", "type": "add_contact_tag", "name": "Add", "attributes": {"tags": ["a"]}, "next": ["s2"]},
             {"id": "s2", "type": "sms", "name": "SMS", "attributes": {}, "parent": "s1"}]
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
    req = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
           {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
           {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "inventario", "arguments": {"loc": LOC}}},
           {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "inventario", "arguments": {"loc": "NOPE"}}}]
    resps = [srv.handle(r) for r in req]
    assert resps[0]["result"]["protocolVersion"]
    assert {t["name"] for t in resps[1]["result"]["tools"]} >= {"dumps", "inventario", "workflow", "achados", "buscar", "jornada"}
    body = json.loads(resps[2]["result"]["content"][0]["text"])
    assert body["summary"]["workflows"] == 1
    assert resps[3]["result"]["isError"] is True


def _ev(i):
    return {"id": f"e{i}", "type": "TAG", "createdAt": f"2026-06-{10 - i:02d}T00:00:00.000Z",
            "sourceId": "wf1", "sourceWorkflowName": "Boas-vindas"}


def test_contato_returns_events_and_snapshot(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_timeline", lambda loc, id, days: {"events": [_ev(0), _ev(1)]})
    out = srv.contato(LOC, "c1")
    assert [e["id"] for e in out["eventos"]] == ["e0", "e1"]
    assert out["truncado"] is False and "_snapshot" in out


def test_contato_drops_noise_keys(root, monkeypatch):
    root(workflows=[wf()])
    ev = {**_ev(0), "traceId": "t", "commonPrimaryId": "c", "_id": "c", "shardId": "s", "secondaryId": "x",
          "apiVersion": "v", "chPublished": True, "externalChange": True}
    monkeypatch.setattr(srv, "_run_timeline", lambda loc, id, days: {"events": [ev]})
    got = srv.contato(LOC, "c1")["eventos"][0]
    assert set(got) == set(_ev(0))


def test_contato_ceiling_pages_by_time(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_timeline", lambda loc, id, days: {"events": [_ev(i) for i in range(9)]})
    monkeypatch.setattr(srv, "CONTATO_MAX_CHARS", 400)
    out = srv.contato(LOC, "c1")
    assert out["truncado"] is True and len(out["eventos"]) < 9
    assert out["proximo_ate"] == out["eventos"][-1]["createdAt"]
    page2 = srv.contato(LOC, "c1", ate=out["proximo_ate"])
    assert page2["eventos"][0]["createdAt"] < out["proximo_ate"]


def test_contato_without_setup_teaches(root, monkeypatch, tmp_path):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "EXTRACTOR_DIR", tmp_path / "nao-existe")
    with pytest.raises(srv.ToolError, match="automaster-extract"):
        srv.contato(LOC, "c1")


def test_editar_calls_extractor_and_lists_triggered_workflows(root, monkeypatch):
    root(workflows=[wf(id="a", name="Tag quente", triggers=[trig("contact_tag", "a", conditions=[tag_cond("quente")])]),
                    wf(id="b", name="Campo mudou", triggers=[trig("contact_changed", "b")])],
         tags=["quente"])
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.setdefault("args", a) and {"id": "c1", "snapshot": "/s.json", "antes": {}, "depois": {}, "mudancas": {}})
    out = srv.editar(LOC, "c1", set={"phone": "+55"}, tags_adicionar=["quente"])
    assert seen["args"][:5] == ("contato-editar", "-l", LOC, "-i", "c1")
    assert "--set" in seen["args"] and "phone=+55" in seen["args"] and "+quente" in seen["args"]
    assert {d["workflow"] for d in out["dispara"]} == {"a", "b"}
    assert out["snapshot"] == "/s.json" and "_snapshot" in out


def _fake_extractor(monkeypatch):
    monkeypatch.setattr(srv, "_run_extractor",
                        lambda *a: {"id": "c1", "snapshot": "/s.json", "antes": {}, "depois": {}, "mudancas": {}})


def test_editar_tags_remover_dispara(root, monkeypatch):
    """Remoção de tag também avisa: trigger contact_tag com condição tagsRemoved."""
    rem = {"operator": "index-of-true", "id": "tag-removed", "value": "quente",
           "title": "Tag Removed", "type": "select", "field": "tagsRemoved"}
    root(workflows=[wf(id="a", name="Saiu quente", triggers=[trig("contact_tag", "a", conditions=[rem])]),
                    wf(id="b", name="Entrou quente",
                       triggers=[trig("contact_tag", "b", conditions=[tag_cond("quente")], tid="tr2")])],
         tags=["quente"])
    _fake_extractor(monkeypatch)
    out = srv.editar(LOC, "c1", tags_remover=["quente"])
    assert {d["workflow"] for d in out["dispara"]} == {"a"}


def test_editar_ignores_draft_workflows(root, monkeypatch):
    root(workflows=[wf(id="a", name="Rascunho", status="draft",
                       triggers=[trig("contact_tag", "a", conditions=[tag_cond("quente")])])],
         tags=["quente"])
    _fake_extractor(monkeypatch)
    assert srv.editar(LOC, "c1", tags_adicionar=["quente"])["dispara"] == []


def test_editar_requires_something_to_change(root):
    root(workflows=[wf()])
    with pytest.raises(srv.ToolError, match="set"):
        srv.editar(LOC, "c1")


def test_conversas_trunca_corpo_e_marca_truncado(root, monkeypatch):
    root(workflows=[wf()])
    longo = "x" * (srv.CONVERSAS_CORPO + 50)
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: {
        "contactId": "c1", "conversationId": "k1", "maisPaginas": True,
        "mensagens": [{"id": "m1", "tipo": "EMAIL", "direcao": "outbound",
                       "origem": "workflow", "corpo": longo}]})
    out = srv.conversas(LOC, "c1")
    m = out["mensagens"][0]
    assert len(m["corpo"]) == srv.CONVERSAS_CORPO and m["corpo_truncado"]
    assert m["origem"] == "workflow"
    assert out["truncado"] is True  # maisPaginas


def test_conversas_passa_atividades_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.setdefault("args", a) and {} or {"mensagens": []})
    srv.conversas(LOC, "c1", max=5, atividades=True)
    assert seen["args"][:6] == ("conversas", "-l", LOC, "-i", "c1", "--max")
    assert "--atividades" in seen["args"]


def test_enviar_externo_sem_confirmo_e_recusado(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.enviar(LOC, "c1", "SMS", "oi")
    assert "confirmo=true" in str(e.value)


def test_enviar_interno_dispensa_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor",
                        lambda *a: seen.update(args=a) or {"enviado": True, "messageId": "m1"})
    out = srv.enviar(LOC, "c1", "internalcomment", "nota")
    assert out["enviado"] and "--tipo" in seen["args"]
    assert seen["args"][seen["args"].index("--tipo") + 1] == "InternalComment"


def test_enviar_email_exige_assunto(root):
    root(workflows=[wf()])
    with pytest.raises(srv.ToolError):
        srv.enviar(LOC, "c1", "Email", "corpo", confirmo=True)


def test_conversa_acao_apagar_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.conversa_acao(LOC, "apagar", id="c1")
    assert "conversa INTEIRA" in str(e.value)


def test_conversa_acao_mensagem_exige_messageid(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError):
        srv.conversa_acao(LOC, "reenviar")


def test_conversa_acao_marca_lida(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.update(args=a) or {"ok": True})
    srv.conversa_acao(LOC, "lida", id="c1")
    assert seen["args"][:3] == ("conversas-marcar", "-l", LOC)
    assert "--confirmo" not in seen["args"]


def test_rascunho_apagar_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError):
        srv.rascunho(LOC, "c1", acao="apagar")


def test_enviar_agendado_recusa_nota_interna(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.enviar(LOC, "c1", "InternalComment", "nota", quando="2026-12-01T10:00:00Z")
    assert "sai na hora" in str(e.value)


def test_conversas_repassa_filtros(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.update(args=a) or {"mensagens": []})
    srv.conversas(LOC, "c1", tipo="TYPE_EMAIL", busca="oi", email="e1")
    for flag, valor in (("--tipo", "TYPE_EMAIL"), ("--busca", "oi"), ("--email", "e1")):
        assert seen["args"][seen["args"].index(flag) + 1] == valor


def test_anexar_recusa_caminho_invalido(root, tmp_path, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError):
        srv.anexar(LOC, "c1", [])
    with pytest.raises(srv.ToolError) as e:
        srv.anexar(LOC, "c1", [str(tmp_path / "nao-existe.png")])
    assert "não existe" in str(e.value)
    with pytest.raises(srv.ToolError) as e:
        srv.anexar(LOC, "c1", [str(tmp_path)])
    assert "não é arquivo" in str(e.value)


def test_anexar_recusa_arquivo_grande(root, tmp_path, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    monkeypatch.setattr(srv, "MAX_ANEXO_BYTES", 10)
    f = tmp_path / "grande.bin"
    f.write_bytes(b"x" * 11)
    with pytest.raises(srv.ToolError) as e:
        srv.anexar(LOC, "c1", [str(f)])
    assert "teto" in str(e.value)


def test_anexar_passa_argumentos_ao_extractor(root, tmp_path, monkeypatch):
    root(workflows=[wf()])
    f = tmp_path / "a.png"
    f.write_bytes(b"png")
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor",
                        lambda *a: seen.update(args=a) or {"subido": True, "urls": ["http://x/a.png"]})
    out = srv.anexar(LOC, "c1", [str(f)], conversa="k1", grupo=True)
    assert out["urls"] == ["http://x/a.png"]
    args = seen["args"]
    assert args[:5] == ("conversas-anexar", "-l", LOC, "-i", "c1")
    assert args[args.index("--arquivo") + 1] == str(f)
    assert args[args.index("--conversa") + 1] == "k1"
    assert "--grupo" in args


def test_whatsapp_enviar_exige_confirmo_e_um_modo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
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
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.update(args=a) or [{"id": "t1"}])
    out = srv.whatsapp(LOC, "templates", template="t1")
    assert out["resultado"] == [{"id": "t1"}]
    assert seen["args"][:5] == ("whatsapp", "-l", LOC, "-o", "templates")
    assert seen["args"][seen["args"].index("--template") + 1] == "t1"
    with pytest.raises(srv.ToolError):
        srv.whatsapp(LOC, "inventado")


def test_config_escrita_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    seen = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.update(args=a) or {})
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
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: seen.update(args=a) or {})
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
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidades(LOC, o="inventar")
    assert "inventar" in str(e.value)


def test_oportunidades_ver_exige_id(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidades(LOC, o="ver")
    assert "id" in str(e.value)


def test_oportunidades_buscar_passa_termo_ao_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"ok": True})
    r = srv.oportunidades(LOC, o="buscar", termo="teto solar")
    assert r["resultado"] == {"ok": True}
    assert "--termo" in visto["args"] and "teto solar" in visto["args"]


def test_oportunidade_acao_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="apagar", id="o1")
    assert "confirmo=true" in str(e.value)


def test_oportunidade_acao_recusa_trocar_contato(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="editar", id="o1", contato="c9", confirmo=True)
    assert "contato" in str(e.value)


def test_oportunidade_acao_criar_exige_os_tres_campos(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.oportunidade_acao(LOC, acao="criar", nome="Teto solar", confirmo=True)
    assert "pipeline" in str(e.value)


def test_oportunidade_acao_mover_chama_o_extractor(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    r = srv.oportunidade_acao(LOC, acao="mover", id="o1", estagio="s2", confirmo=True)
    assert r["aplicado"] is True
    assert "--estagio" in visto["args"] and "s2" in visto["args"]


def test_pipeline_exige_confirmo(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.pipeline(LOC, acao="apagar", id="p1")
    assert "confirmo=true" in str(e.value)


def test_pipeline_editar_exige_lista_de_estagios(root, monkeypatch):
    root(workflows=[wf()])
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: pytest.fail("não podia chamar o extractor"))
    with pytest.raises(srv.ToolError) as e:
        srv.pipeline(LOC, acao="editar", id="p1", confirmo=True)
    assert "estagios" in str(e.value)


def test_pipeline_serializa_estagios_como_json(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    srv.pipeline(LOC, acao="criar", nome="zz", estagios=[{"name": "Novo"}], confirmo=True)
    assert '[{"name": "Novo"}]' in visto["args"]


def test_pipeline_passa_apagar_com_cards(root, monkeypatch):
    root(workflows=[wf()])
    visto = {}
    monkeypatch.setattr(srv, "_run_extractor", lambda *a: visto.update(args=a) or {"aplicado": True})
    srv.pipeline(LOC, acao="editar", id="p1", estagios=[{"id": "s1", "name": "A"}],
                 confirmo=True, apagar_com_cards=True)
    assert "--apagar-com-cards" in visto["args"]
