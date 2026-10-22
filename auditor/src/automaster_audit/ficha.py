"""Gera a ficha por workflow (Markdown): configurações, gatilhos e passos em ordem.

Não avalia condições: descreve o que o dump guarda, com o nome ao lado de cada id
de pipeline, estágio, usuário e workflow quando o dump tem o nome.
"""

from __future__ import annotations

from .flow import index_steps, is_branch_node, roots, successors
from .loader import DumpContext, Workflow
from .path_report import describe_step

_MENSAGEM = ("sms", "whatsapp_v2", "email", "internal_notification")
_LIMITE_TEXTO = 300
_UNIDADES = {
    "minutes": ("min", "min"),
    "hours": ("hora", "horas"),
    "days": ("dia", "dias"),
    "weeks": ("semana", "semanas"),
    "months": ("mês", "meses"),
}
_QUANDO = {"after": "depois", "before": "antes"}


def _sim_nao(v) -> str:
    return "sim" if v else "não"


def _nomeado(ctx: DumpContext, valor) -> str:
    """Valor com o nome ao lado quando é id conhecido; lista vira itens separados por vírgula."""
    if isinstance(valor, list):
        return ", ".join(_nomeado(ctx, v) for v in valor)
    texto = str(valor)
    for nomes in (ctx.workflow_names, ctx.pipeline_names, ctx.stage_names, ctx.user_names):
        nome = nomes.get(texto)
        if nome and nome != texto:
            return f"{texto} ({nome})"
    return texto


def _resumo(t) -> str | None:
    if not isinstance(t, str) or not t.strip():
        return None
    t = " ".join(t.split())
    return t[:_LIMITE_TEXTO] + ("…" if len(t) > _LIMITE_TEXTO else "")


def _texto_mensagem(step: dict) -> str | None:
    a = step.get("attributes") or {}
    notif = a.get("notification")
    for t in (a.get("body"), a.get("message"), notif.get("body") if isinstance(notif, dict) else None):
        if texto := _resumo(t):
            return texto
    return None


def _modelo_aviso(step: dict, ctx: DumpContext) -> list[str]:
    """Aviso interno por SMS/e-mail que tira o texto de um modelo: nome e corpo, ou o id sem o modelo."""
    a = step.get("attributes") or {}
    canal = a.get("type")
    config = a.get(canal) if canal in ("sms", "email") else None
    tid = str(config.get("template_id") or "").strip() if isinstance(config, dict) else ""
    if not tid:
        return []
    modelo = next((t for t in ctx.message_templates if str(t.get("id") or t.get("_id") or "") == tid), None)
    if modelo is None:
        assunto = _resumo(config.get("subject")) if canal == "email" else None
        return [f"modelo `{tid}`"] + ([f"assunto: {assunto}"] if assunto else [])
    corpo = _resumo((modelo.get("template") or {}).get("body"))
    linhas = [f"modelo **{modelo.get('name') or tid}**"]
    return linhas + ([f"texto: {corpo}"] if corpo else [])


def _regra_espera(step: dict) -> str | None:
    a = step.get("attributes") or {}
    if a.get("type") == "appointment":
        regra, sufixo = a.get("appointmentStartAfter"), " do compromisso"
    else:
        regra, sufixo = a.get("startAfter"), ""
    if not isinstance(regra, dict) or regra.get("value") is None:
        return None
    valor = regra.get("value")
    sing, plur = _UNIDADES.get(regra.get("type"), (regra.get("type") or "", regra.get("type") or ""))
    unidade = sing if valor == 1 else plur
    quando = _QUANDO.get(regra.get("when"), regra.get("when") or "depois")
    return f"{valor} {unidade} {quando}{sufixo}".replace("  ", " ")


def _condicoes_ramo(container: dict, ramo_id: str) -> list[tuple]:
    """Condições do ramo de um if_else (`branches[].segments[].conditions[]`): (campo, operador, valor)."""
    out: list[tuple] = []
    for b in (container.get("attributes") or {}).get("branches") or []:
        if b.get("id") != ramo_id:
            continue
        for seg in b.get("segments") or []:
            for c in seg.get("conditions") or []:
                campo = c.get("conditionSubType") or c.get("conditionType") or "?"
                out.append((campo, c.get("conditionOperator") or "?", c.get("conditionValue")))
    return out


def _rotulo_ramo(container: dict, node: dict) -> str:
    for b in (container.get("attributes") or {}).get("branches") or []:
        if b.get("id") == node.get("id") and b.get("name"):
            return b["name"]
    if "else" in (node.get("attributes") or {}):
        return (container.get("attributes") or {}).get("noneBranchName") or node.get("name") or "senão"
    return node.get("name") or node.get("id") or "?"


def _linha_passo(step: dict, ctx: DumpContext) -> str:
    tipo = step.get("type") or "?"
    nome = step.get("name") or tipo
    linha = f"**{nome}** (`{tipo}`)"
    detalhe = _regra_espera(step) if tipo == "wait" else describe_step(step, ctx)
    if detalhe and detalhe not in (tipo, nome):
        linha += f": {detalhe}"
    return linha


def _passos(wf: Workflow, ctx: DumpContext) -> list[str]:
    by_id = index_steps(wf)
    linhas: list[str] = []
    vistos: set[str] = set()

    def item(nivel: int, texto: str) -> None:
        linhas.append(f"{'  ' * nivel}- {texto}")

    def cadeia(nid: str | None, nivel: int) -> None:
        while nid:
            step = by_id.get(nid)
            if step is None:
                item(nivel, f"passo ausente no dump: `{nid}`")
                return
            if nid in vistos:
                item(nivel, f"volta para **{step.get('name') or nid}**")
                return
            vistos.add(nid)
            item(nivel, _linha_passo(step, ctx))
            tipo = step.get("type")
            a = step.get("attributes") or {}
            if tipo in _MENSAGEM:
                texto = _texto_mensagem(step)
                if texto:
                    item(nivel + 1, f"texto: {texto}")
                elif tipo == "email" and (assunto := _resumo(a.get("subject"))):
                    item(nivel + 1, f"assunto: {assunto}")
                elif tipo == "internal_notification":
                    for linha in _modelo_aviso(step, ctx):
                        item(nivel + 1, linha)
            if tipo == "find_opportunity":
                for f in a.get("__customInputFields__") or []:
                    if isinstance(f, dict):
                        valor = _nomeado(ctx, f.get("secondValue", ""))
                        item(nivel + 1, f"filtro: {f.get('filterField')} {f.get('value')} {valor}")
            if tipo == "goto":
                return
            nxt = step.get("next")
            if isinstance(nxt, list):
                for rid in successors(step):
                    ramo = by_id.get(rid)
                    if ramo is None:
                        item(nivel + 1, f"ramo ausente no dump: `{rid}`")
                        continue
                    vistos.add(rid)
                    item(nivel + 1, f"ramo **{_rotulo_ramo(step, ramo)}**")
                    for campo, op, valor in _condicoes_ramo(step, rid):
                        item(nivel + 2, f"se {campo} {op} {_nomeado(ctx, valor)}")
                    corpo = successors(ramo) if is_branch_node(ramo) else [rid]
                    if not corpo:
                        item(nivel + 2, "(sem passos)")
                    for cid in corpo:
                        cadeia(cid, nivel + 2)
                return
            seguintes = successors(step)
            nid = seguintes[0] if seguintes else None

    for rid in roots(wf):
        cadeia(rid, 0)
    return linhas


def _ficha(wf: Workflow, ctx: DumpContext) -> str:
    detail = wf.raw.get("detail") or {}
    pasta = (wf.raw.get("list_entry") or {}).get("parentId") or "fora de pasta"
    out = [
        f"## {wf.name}",
        "",
        f"- **Id:** `{wf.id}`",
        f"- **Status:** {wf.status}",
        f"- **Pasta:** {pasta}",
        f"- **Reentrada:** {_sim_nao(detail.get('allowMultiple'))}",
        f"- **Parar quando responder:** {_sim_nao(detail.get('stopOnResponse'))}",
        f"- **Várias oportunidades:** {_sim_nao(detail.get('allowMultipleOpportunity'))}",
        "",
        "### Gatilhos",
        "",
    ]
    if not wf.triggers:
        out.append("- sem gatilho")
    for t in wf.triggers:
        estado = "ativo" if t.get("active") else "inativo"
        out.append(f"- **{t.get('name') or t.get('type') or '?'}** (`{t.get('type') or '?'}`), {estado}")
        for c in t.get("conditions") or []:
            if isinstance(c, dict):
                out.append(f"  - {c.get('field')} {c.get('operator')} {_nomeado(ctx, c.get('value', ''))}")
    out += ["", "### Passos", ""]
    passos = _passos(wf, ctx)
    out += passos or ["- sem passos"]
    return "\n".join(out) + "\n"


def gerar_fichas(ctx: DumpContext, workflow_id: str | None = None) -> str:
    """Fichas em Markdown, na ordem de pasta e nome. `ValueError` se o id não existe no dump."""
    workflows = ctx.workflows
    if workflow_id is not None:
        workflows = [w for w in workflows if w.id == workflow_id]
        if not workflows:
            raise ValueError(f"workflow não encontrado no dump: {workflow_id}")
    if not workflows:
        return "# Fichas de workflows\n\nnenhum workflow no dump.\n"
    workflows = sorted(
        workflows, key=lambda w: ((w.raw.get("list_entry") or {}).get("parentId") or "", w.name.lower(), w.id)
    )
    return "# Fichas de workflows\n\n" + "\n".join(_ficha(w, ctx) for w in workflows)
