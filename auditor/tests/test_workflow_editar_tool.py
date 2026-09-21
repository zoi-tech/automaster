import pytest

from automaster_audit import mcp_server


class _ResultadoFalso:
    def __init__(self, pode_gravar, erros_novos=None, erros_resolvidos=None, triggers_do_dump=False):
        self.pode_gravar = pode_gravar
        self.erros_novos = erros_novos or []
        self.erros_resolvidos = erros_resolvidos or []
        self.triggers_do_dump = triggers_do_dump


class _WfFalso:
    def __init__(self, wid):
        self.id = wid


class _CtxFalso:
    """Contexto mínimo: a tool só precisa saber se o workflow está no dump."""

    def __init__(self, *ids):
        self.workflows = [_WfFalso(i) for i in ids]


def test_tool_esta_registrada():
    assert "workflow_editar" in mcp_server.TOOLS
    func, descricao, schema, obrigatorios = mcp_server.TOOLS["workflow_editar"]
    assert callable(func)
    assert "loc" in obrigatorios and "acao" in obrigatorios
    assert "ESCREVE" in descricao


def test_acao_invalida_e_recusada_sem_chamar_o_extractor(monkeypatch):
    chamou = []
    monkeypatch.setattr(mcp_server, "_run_extractor", lambda *a: chamou.append(a))
    with pytest.raises(mcp_server.ToolError, match="acao"):
        mcp_server.workflow_editar(loc="L1", acao="explodir", id="W1")
    assert chamou == []


def test_gravar_sem_confirmo_nao_chega_a_escrever(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": False, "motivo": "prévia: rode de novo com --confirmo para gravar"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b")
    assert r["aplicado"] is False
    assert "--confirmo" not in vistos[0]


def test_confirmo_true_passa_a_flag_para_o_extractor(monkeypatch):
    # "L1" não tem dump em disco: cai no caminho "sem dump", que não trava a escrita.
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": True, "registro": "/tmp/x.json"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert any("--confirmo" in v for v in vistos)
    assert any("--json" in v for v in vistos)
    assert r["validacao"]["rodou"] is False


def test_sem_dump_em_disco_nao_trava_a_escrita(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        if "--confirmo" in args:
            return {"aplicado": True, "registro": "/tmp/x.json"}
        return {"aplicado": False, "motivo": "prévia", "diff": {"x": 1},
                "documento": {"name": "wf"}}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)

    def sem_dump(loc, snap):
        raise mcp_server.ToolError("subconta sem dump")

    monkeypatch.setattr(mcp_server, "_load", sem_dump)
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert len(vistos) == 2
    assert r["validacao"]["rodou"] is False


def test_gravacao_recusada_por_erro_novo_nao_chama_a_segunda_vez(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": False, "motivo": "prévia", "diff": {"x": 1},
                "documento": {"name": "wf"}}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "2026-01-01_0000"}))
    monkeypatch.setattr(
        mcp_server, "validar_edicao",
        lambda ctx, wid, doc, triggers=None: _ResultadoFalso(pode_gravar=False, erros_novos=["broken_tag_ref: x"]),
    )
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is False
    assert "broken_tag_ref" in r["motivo"]
    assert r["validacao"]["pode_gravar"] is False
    assert len(vistos) == 1  # só a prévia — a segunda chamada (--confirmo) não aconteceu
    assert not any("--confirmo" in v for v in vistos)


def test_gravacao_passa_pela_validacao_e_grava(monkeypatch):
    vistos = []

    def falso(*args):
        vistos.append(args)
        if "--confirmo" in args:
            return {"aplicado": True, "registro": "/tmp/x.json"}
        return {"aplicado": False, "motivo": "prévia", "diff": {"x": 1},
                "documento": {"name": "wf"}}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "2026-01-01_0000"}))
    monkeypatch.setattr(
        mcp_server, "validar_edicao",
        lambda ctx, wid, doc, triggers=None: _ResultadoFalso(pode_gravar=True),
    )
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["aplicado"] is True
    assert r["validacao"]["rodou"] is True
    assert r["validacao"]["pode_gravar"] is True
    assert len(vistos) == 2
    assert any("--confirmo" in v for v in vistos)


def test_workflow_fora_do_dump_nao_estoura_e_avisa_antes_do_chrome(monkeypatch):
    """Workflow recém-criado ou duplicado não está no dump: antes isso era ValueError crua,
    e a prévia (que abre o Chrome) já tinha rodado. Agora a checagem vem primeiro."""
    ordem = []

    def falso(*args):
        ordem.append("extractor")
        if "--confirmo" in args:
            return {"aplicado": True, "registro": "/tmp/x.json"}
        return {"aplicado": False, "motivo": "prévia", "documento": {"name": "wf"}}

    def carrega(loc, snap):
        ordem.append("dump")
        return _CtxFalso("OUTRO"), {"snapshot": "2026-01-01_0000"}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    monkeypatch.setattr(mcp_server, "_load", carrega)
    monkeypatch.setattr(mcp_server, "validar_edicao", lambda *a, **k: pytest.fail("não devia validar"))

    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert ordem[0] == "dump"  # o dump é lido antes de abrir o Chrome
    assert r["aplicado"] is True
    assert r["validacao"]["rodou"] is False
    assert "não está no dump" in r["validacao"]["motivo"]


def test_triggers_lidos_ao_vivo_chegam_na_validacao(monkeypatch):
    """O documento do GHL não traz trigger; a lista autoritativa vem da prévia."""
    recebidos = {}

    def falso(*args):
        if "--confirmo" in args:
            return {"aplicado": True}
        return {"aplicado": False, "documento": {"name": "wf"},
                "triggers": [{"id": "T1", "name": "Form"}]}

    def validar(ctx, wid, doc, triggers=None):
        recebidos["triggers"] = triggers
        return _ResultadoFalso(pode_gravar=True)

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "S"}))
    monkeypatch.setattr(mcp_server, "validar_edicao", validar)
    mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert recebidos["triggers"] == [{"id": "T1", "name": "Form"}]


def test_validacao_sem_triggers_ao_vivo_diz_que_usou_o_dump(monkeypatch):
    monkeypatch.setattr(mcp_server, "_run_extractor",
                        lambda *a: {"aplicado": False, "documento": {"name": "wf"}})
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "S"}))
    monkeypatch.setattr(mcp_server, "validar_edicao",
                        lambda *a, **k: _ResultadoFalso(pode_gravar=True, triggers_do_dump=True))
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b")
    assert "veio do dump" in r["validacao"]["aviso"]


def test_schema_nao_oferece_mais_adicionar_nem_substituir_trigger():
    _, _, schema, _ = mcp_server.TOOLS["workflow_editar"]
    assert schema["trigger_acao"]["enum"] == ["remover"]
    assert "trigger" not in schema


def _previa_trigger():
    """Forma real da saída de `--acao trigger --trigger-acao remover` sem --confirmo:
    documento lido (corpo intacto) + `triggers` já SEM o trigger removido."""
    return {"aplicado": False, "motivo": "prévia: rode de novo com --confirmo para gravar",
            "acao": "trigger", "id": "W1",
            "diff": {"triggersRemovidos": [{"id": "T1", "nome": "Formulário Enviado"}]},
            "mudancas": ["trigger T1 removido"],
            "documento": {"name": "wf", "workflowData": {"templates": []}},
            "triggers": []}


def test_remover_trigger_passa_pela_validacao_das_18_regras(monkeypatch):
    """Remover trigger é o caso mais provável de `workflow_unreachable`: não pode gravar
    sem validar. A saída da ação não tem o mesmo formato das outras — daí o teste próprio."""
    vistos, recebidos = [], {}

    def falso(*args):
        vistos.append(args)
        if "--confirmo" in args:
            return {"aplicado": True, "registro": "/tmp/x.json"}
        return _previa_trigger()

    def validar(ctx, wid, doc, triggers=None):
        recebidos["triggers"] = triggers
        return _ResultadoFalso(pode_gravar=False, erros_novos=["workflow_unreachable: sem entrada"])

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "S"}))
    monkeypatch.setattr(mcp_server, "validar_edicao", validar)

    r = mcp_server.workflow_editar(loc="L1", acao="trigger", id="W1",
                                   trigger_acao="remover", trigger_id="T1", confirmo=True)
    assert recebidos["triggers"] == []          # a lista DEPOIS da remoção
    assert r["validacao"]["rodou"] is True
    assert r["aplicado"] is False
    assert "workflow_unreachable" in r["motivo"]
    assert len(vistos) == 1                     # a gravação não aconteceu
    assert not any("--confirmo" in v for v in vistos)


def test_previa_de_trigger_sem_confirmo_traz_validacao(monkeypatch):
    monkeypatch.setattr(mcp_server, "_run_extractor", lambda *a: _previa_trigger())
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "S"}))
    monkeypatch.setattr(mcp_server, "validar_edicao",
                        lambda *a, **k: _ResultadoFalso(pode_gravar=True))
    r = mcp_server.workflow_editar(loc="L1", acao="trigger", id="W1",
                                   trigger_acao="remover", trigger_id="T1")
    assert r["validacao"]["rodou"] is True and r["validacao"]["pode_gravar"] is True


def test_sem_documento_a_resposta_diz_que_nao_validou(monkeypatch):
    """"nada a mudar": a chave `validacao` não pode simplesmente sumir."""
    monkeypatch.setattr(mcp_server, "_run_extractor",
                        lambda *a: {"aplicado": False, "motivo": "nada a mudar"})
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "S"}))
    monkeypatch.setattr(mcp_server, "validar_edicao", lambda *a, **k: pytest.fail("não há o que validar"))
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert r["validacao"]["rodou"] is False
    assert "não devolveu documento" in r["validacao"]["motivo"]


# --- I1: a prévia e a gravação são dois processos, com um Chrome subindo no meio ---

def test_versao_da_previa_viaja_para_a_gravacao(monkeypatch):
    """Sem carregar a `version` que a prévia leu, a guarda de concorrência não enxerga
    nada do que mudou entre os dois processos — uma janela de dezenas de segundos."""
    vistos = []

    def falso(*args):
        vistos.append(args)
        return {"aplicado": False, "documento": {"workflowData": {}}, "versao": 7}

    monkeypatch.setattr(mcp_server, "_run_extractor", falso)
    mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert "--versao-esperada" not in vistos[0]          # a prévia não recebe a flag
    assert "--versao-esperada" in vistos[1] and "7" in vistos[1]


def test_sem_versao_na_previa_a_gravacao_nao_inventa_uma(monkeypatch):
    vistos = []
    monkeypatch.setattr(mcp_server, "_run_extractor",
                        lambda *a: vistos.append(a) or {"aplicado": False})
    mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b", confirmo=True)
    assert "--versao-esperada" not in vistos[1]


# --- M3: o documento inteiro não volta para o contexto do modelo ---

def test_documento_sai_da_resposta_depois_de_validar(monkeypatch):
    doc = {"workflowData": {"templates": [{"id": "s1"}]}}
    monkeypatch.setattr(mcp_server, "_run_extractor",
                        lambda *a: {"aplicado": False, "documento": doc, "diff": {"vazio": False}})
    monkeypatch.setattr(mcp_server, "_load", lambda loc, snap: (_CtxFalso("W1"), {"snapshot": "S"}))
    monkeypatch.setattr(mcp_server, "validar_edicao", lambda *a: _ResultadoFalso(True))
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b")
    assert "documento" not in r
    assert r["validacao"]["rodou"] is True
    assert r["diff"] == {"vazio": False}


def test_documento_sai_da_resposta_tambem_sem_dump(monkeypatch):
    monkeypatch.setattr(mcp_server, "_run_extractor",
                        lambda *a: {"aplicado": False, "documento": {"x": 1}})
    r = mcp_server.workflow_editar(loc="L1", acao="trocar-tag", id="W1", de="a", para="b")
    assert "documento" not in r and r["validacao"]["rodou"] is False


# --- M2: a dica do timeout tem que apontar para a tool certa ---

def test_timeout_de_workflow_manda_conferir_com_a_tool_de_workflow(monkeypatch, tmp_path):
    import subprocess
    tsx = tmp_path / "node_modules" / ".bin" / "tsx"
    tsx.parent.mkdir(parents=True)
    tsx.touch()
    monkeypatch.setattr(mcp_server, "EXTRACTOR_DIR", tmp_path)
    def estoura(*a, **k):
        raise subprocess.TimeoutExpired(cmd="tsx", timeout=600, stderr="")
    monkeypatch.setattr(subprocess, "run", estoura)
    with pytest.raises(mcp_server.ToolError) as e:
        mcp_server._run_extractor("workflow-editar", "-l", "L1")
    assert "workflows_ao_vivo" in str(e.value) and "`contato`" not in str(e.value)
