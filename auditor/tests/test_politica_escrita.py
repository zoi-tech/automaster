"""A escrita de workflow só entra pela porta com guarda — provado por varredura, não por disciplina.

As 18 regras rodam em Python e o efeito acontece em TypeScript: o que mantém os dois juntos
é a flag `--sem-regras`, que a camada crua exige para gravar. Se um caminho novo emitir essa
flag, ou chamar `workflow-editar --confirmo` de outro módulo, a guarda deixa de valer sem
que nada quebre. Estes testes falham nesse dia.
"""
from pathlib import Path

from automaster_audit import mcp_server

PACOTE = Path(mcp_server.__file__).parent
PORTA = "mcp/workflows.py"  # o único módulo autorizado a gravar workflow


def _fontes():
    return {p.relative_to(PACOTE).as_posix(): p.read_text(encoding="utf-8")
            for p in PACOTE.rglob("*.py")}


def test_so_a_porta_com_guarda_emite_sem_regras():
    culpados = sorted(nome for nome, src in _fontes().items() if "--sem-regras" in src)
    assert culpados == [PORTA], (
        "`--sem-regras` é a chave da camada crua: só a porta que roda `validar_edicao` "
        f"pode emiti-la. Apareceu em: {culpados}"
    )


def test_nenhum_outro_modulo_chama_o_comando_de_escrita_de_workflow():
    """`cli.py` cita o nome como subcomando, o que vale; rodar o comando é que não."""
    culpados = sorted(nome for nome, src in _fontes().items()
                      if '_run_extractor("workflow-editar"' in src and nome != PORTA)
    assert culpados == [], f"escrita de workflow fora da porta com guarda: {culpados}"


def test_a_porta_com_guarda_valida_antes_de_gravar():
    fonte = (PACOTE / PORTA).read_text(encoding="utf-8")
    assert "validar_edicao" in fonte
    assert fonte.index("validar_edicao") < fonte.rindex("--sem-regras")


def test_a_tool_nao_aceita_do_agente_nada_que_vire_sem_regras():
    """O agente não pode pedir para passar por fora: a flag não é parâmetro da tool."""
    _, _, schema, _ = mcp_server.TOOLS["workflow_editar"]
    assert not [p for p in schema if "regra" in p or "cru" in p]
