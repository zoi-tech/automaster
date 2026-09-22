"""Confere a forma do dump contra `dump_schema.json`, o contrato das duas metades.

Antes disto o formato do dump só existia em prosa no CLAUDE.md e no docstring do loader:
uma mudança de formato do extractor só aparecia quando alguma regra quebrava três camadas
adiante, com mensagem que não apontava para a causa. O mesmo arquivo é lido pelo extractor
no fim da extração (`extractor/src/dump/schema.ts`), então as duas pontas conferem o mesmo.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("dump_schema.json")

_TIPOS = {"string": str, "number": (int, float), "boolean": bool, "object": dict, "array": list}


@lru_cache(maxsize=1)
def carregar_schema(caminho: str = "") -> dict:
    return json.loads(Path(caminho or SCHEMA_PATH).read_text(encoding="utf-8"))


def _descer(doc: dict, caminho: str):
    """`raw.list_entry` desce um nível. Ausente devolve o sentinela, que não é None."""
    atual: object = doc
    for parte in caminho.split("."):
        if not isinstance(atual, dict) or parte not in atual:
            return _AUSENTE
        atual = atual[parte]
    return atual


_AUSENTE = object()


def _conferir_doc(doc: object, regra: dict, rotulo: str) -> list[str]:
    if not isinstance(doc, dict):
        return [f"{rotulo}: esperado objeto, veio {type(doc).__name__}"]
    problemas = []
    for campos, obrigatorio in ((regra.get("campos", {}), True), (regra.get("opcionais", {}), False)):
        for caminho, tipo in campos.items():
            valor = _descer(doc, caminho)
            if valor is _AUSENTE:
                if obrigatorio:
                    problemas.append(f"{rotulo}: campo obrigatório ausente: {caminho}")
                continue
            esperado = _TIPOS.get(tipo)
            # bool é subclasse de int em Python: number não pode aceitar True
            if esperado and (not isinstance(valor, esperado) or (tipo == "number" and isinstance(valor, bool))):
                problemas.append(f"{rotulo}: {caminho} deveria ser {tipo}, veio {type(valor).__name__}")
    return problemas


def validar_dump(path: Path, schema: dict | None = None) -> list[str]:
    """Lista de problemas de forma; vazia = dump no contrato. Não lê o conteúdo, só a forma."""
    schema = schema or carregar_schema()
    problemas: list[str] = []
    for nome, regra in schema["arquivos"].items():
        if nome.endswith("/*.json"):
            pasta = path / nome.split("/")[0]
            if not pasta.is_dir():
                problemas.append(f"pasta ausente no dump: {nome.split('/')[0]}/")
                continue
            for arq in sorted(pasta.glob("*.json")):
                problemas += _conferir_arquivo(arq, regra, f"{pasta.name}/{arq.name}")
            continue
        arq = path / nome
        if not arq.is_file():
            if not regra.get("facultativo"):
                problemas.append(f"arquivo ausente no dump: {nome}")
            continue
        problemas += _conferir_arquivo(arq, regra, nome)
    return problemas


def _conferir_arquivo(arq: Path, regra: dict, rotulo: str) -> list[str]:
    try:
        doc = json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return [f"{rotulo}: não deu para ler ({e})"]
    return _conferir_doc(doc, regra, rotulo)
