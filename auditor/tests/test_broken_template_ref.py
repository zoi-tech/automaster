"""broken_template_ref: step citando template que sumiu."""
from automaster_audit.loader import load_dump
from automaster_audit.rules.broken_template_ref import check

from conftest import wf


def _step(tipo, tid, campo="template_id", sid="s1"):
    return {"id": sid, "type": tipo, "name": f"Manda {tipo}", "attributes": {campo: tid}}


def test_sem_lista_de_templates_nao_acusa_nada(make_dump):
    """Dump antigo (ou canal desligado) deixa a regra no-op."""
    ctx = load_dump(make_dump(workflows=[wf(id="w1", steps=[_step("sms", "T1")])]))
    assert check(ctx) == []


def test_template_existente_passa(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(id="w1", steps=[
            _step("sms", "T1"),
            _step("whatsapp_v2", "W1", sid="s3"),
        ])],
        message_templates=[{"id": "T1", "name": "Follow-up"}],
        whatsapp_templates=[{"id": "W1", "name": "Lembrete"}],
    ))
    assert check(ctx) == []


def test_template_sumido_vira_error(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(id="w1", steps=[_step("sms", "SUMIU")])],
        message_templates=[{"id": "T1", "name": "Follow-up"}],
    ))
    (f,) = check(ctx)
    assert f.rule == "broken_template_ref"
    assert f.severity == "ERROR"
    assert "SUMIU" in f.detail


def test_canal_sem_lista_nao_contamina_canal_com_lista(make_dump):
    """Só a lista de mensagem veio: o step de WhatsApp fica fora do julgamento."""
    ctx = load_dump(make_dump(
        workflows=[wf(id="w1", steps=[
            _step("whatsapp_v2", "SUMIU"),
            _step("sms", "TAMBEM_SUMIU", sid="s2"),
        ])],
        message_templates=[{"id": "T1", "name": "Follow-up"}],
    ))
    (f,) = check(ctx)
    assert "TAMBEM_SUMIU" in f.detail


def test_email_fica_fora_da_regra(make_dump):
    """E-mail tem regra própria (`stale_email_template`, WARN); aqui não é julgado."""
    ctx = load_dump(make_dump(
        workflows=[wf(id="w1", steps=[_step("email", "QUALQUER")])],
        message_templates=[{"id": "T1", "name": "Follow-up"}],
    ))
    assert check(ctx) == []


def test_instagram_usa_a_lista_de_mensagem_e_o_campo_templateId(make_dump):
    ctx = load_dump(make_dump(
        workflows=[wf(id="w1", steps=[_step("ig_interactive_messenger", "SUMIU", campo="templateId")])],
        message_templates=[{"id": "T1", "name": "Follow-up"}],
    ))
    assert len(check(ctx)) == 1


def test_template_id_zero_e_mensagem_livre_nao_acusa(make_dump):
    """'0' é o 'None - Free form message' do próprio app, não referência quebrada."""
    ctx = load_dump(make_dump(
        workflows=[wf(id="w1", steps=[_step("whatsapp_v2", "0")])],
        whatsapp_templates=[{"id": "W1", "name": "Lembrete"}],
    ))
    assert check(ctx) == []
