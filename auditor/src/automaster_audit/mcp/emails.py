"""Templates do email builder."""

from __future__ import annotations

from html.parser import HTMLParser
from urllib.request import Request, urlopen

from ..rules._helpers import email_template_id, steps_of_type
from . import base
from .base import _LOC, _SNAP, ToolError

MODELOS_OP = ("lista", "usos", "conteudo")

# O `token` do previewUrl é dispensável (medido ao vivo) e troca a cada vez que o arquivo é
# sobrescrito, então a URL é remontada a partir do id do snapshot corrente.
_EMAIL_URL = (
    "https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/"
    "location%2F{loc}%2Femails%2F{tid}%2Findex.html?alt=media"
)

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)


def _ler_url(url: str) -> bytes:
    """Isolada para o teste trocar. Única ida à rede do servidor: URL pública, sem credencial."""
    with urlopen(Request(url, headers={"user-agent": _UA}), timeout=20) as r:
        return r.read()


class _Texto(HTMLParser):
    """Texto visível e hrefs de um HTML de e-mail; o markup inteiro é grande demais."""

    def __init__(self) -> None:
        super().__init__()
        self.partes: list[str] = []
        self.links: list[str] = []
        self._pular = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._pular = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._pular = False

    def handle_data(self, data):
        if not self._pular and data.strip():
            self.partes.append(data.strip())


def modelos_email(loc: str, o: str = "lista", id: str | None = None, snapshot: str | None = None) -> dict:
    if o not in MODELOS_OP:
        raise ToolError(f"operação {o!r} inválida; use uma de {MODELOS_OP}")
    ctx, meta = base._load(loc, snapshot)

    if o == "lista":
        modelos = [
            {
                "id": str(b.get("id")),
                "nome": b.get("name"),
                "pasta": b.get("parentId"),
                "criado": b.get("dateAdded"),
                "alterado": b.get("lastUpdated"),
                "texto_puro": b.get("isPlainText"),
            }
            for b in ctx.email_templates
        ]
        return {"modelos": modelos, "_snapshot": meta}

    if o == "usos":
        usos: dict[str, list[dict]] = {}
        for wf, step in steps_of_type(ctx, "email"):
            tid = email_template_id(step)
            if not tid:
                continue
            usos.setdefault(tid, []).append(
                {
                    "workflow": wf.name,
                    "step": step.get("name", step.get("type")),
                    "assunto": (step.get("attributes") or {}).get("subject", ""),
                }
            )
        conhecidos = {str(b.get("id")) for b in ctx.email_templates}
        return {
            "usos": usos,
            "sem_uso": sorted(conhecidos - set(usos)),
            "fora_do_builder": sorted(set(usos) - conhecidos),
            "_snapshot": meta,
        }

    if not id:
        raise ToolError("conteudo exige `id`; pegue um com a operação `lista` ou `usos`")
    location_id = ctx.manifest.get("locationId", loc)
    p = _Texto()
    p.feed(_ler_url(_EMAIL_URL.format(loc=location_id, tid=id)).decode("utf-8", "replace"))
    return {"id": id, "texto": "\n".join(p.partes), "links": p.links, "_snapshot": meta}


TOOLS = {
    "modelos_email": (
        modelos_email,
        (
            "DO DUMP: templates do email builder. `lista` (id, nome, pasta, datas), "
            "`usos` (qual workflow e step cita cada um, quais ninguém usa, quais o "
            "builder não tem) e `conteudo` (texto e links de um template, baixado na "
            "hora). Não é o corpo de e-mail de uma conversa — para isso use `conversas`."
        ),
        {
            "loc": _LOC,
            "o": {"type": "string", "enum": list(MODELOS_OP)},
            "id": {"type": "string", "description": "template, obrigatório em `conteudo`"},
            "snapshot": _SNAP,
        },
        ["loc"],
    ),
}
