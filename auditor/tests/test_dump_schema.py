"""O contrato de formato do dump, o mesmo arquivo que o extractor confere."""
import json

import pytest

from automaster_audit.dump_schema import carregar_schema, validar_dump
from automaster_audit.loader import DumpError, load_dump


def test_dump_da_fixture_esta_no_contrato(make_dump):
    assert validar_dump(make_dump(workflows=[], tags=["a"])) == []


def test_schema_e_o_mesmo_que_o_extractor_le():
    from pathlib import Path
    import automaster_audit
    esperado = Path(automaster_audit.__file__).with_name("dump_schema.json")
    assert esperado.is_file(), "o extractor procura o schema exatamente neste caminho"
    assert carregar_schema()["schemaVersion"] == json.loads(esperado.read_text())["schemaVersion"]


def test_tipo_trocado_e_campo_ausente_sao_acusados_com_o_caminho(make_dump):
    root = make_dump(workflows=[])
    (root / "tags.json").write_text(json.dumps({"fetchedAt": "x", "raw": {"tags": {}}}))
    (root / "pipelines.json").write_text(json.dumps({"raw": {"pipelines": []}}))
    problemas = validar_dump(root)
    assert "tags.json: raw.tags deveria ser array, veio dict" in problemas
    assert "pipelines.json: campo obrigatório ausente: fetchedAt" in problemas


def test_arquivo_opcional_ausente_nao_acusa_e_obrigatorio_sim(make_dump):
    root = make_dump(workflows=[])
    assert not (root / "forms.json").exists()
    assert validar_dump(root) == []
    (root / "tags.json").unlink()
    assert validar_dump(root) == ["arquivo ausente no dump: tags.json"]


def test_load_dump_recusa_dump_fora_do_contrato_apontando_a_causa(make_dump):
    root = make_dump(workflows=[])
    (root / "custom_fields.json").write_text(json.dumps({"fetchedAt": "x", "raw": {}}))
    with pytest.raises(DumpError) as e:
        load_dump(root)
    assert "raw.customFields" in str(e.value) and "dump_schema.json" in str(e.value)


def test_number_nao_aceita_boolean(make_dump):
    """bool é subclasse de int em Python: sem a guarda, `schemaVersion: true` passaria."""
    root = make_dump(workflows=[])
    m = json.loads((root / "manifest.json").read_text())
    m["counts"] = 1
    (root / "manifest.json").write_text(json.dumps(m))
    assert any("counts deveria ser object" in p for p in validar_dump(root))
