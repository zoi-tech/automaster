# Protótipo 007 — A sessão ideal

Transcripts escritos à mão contra as oito tools decididas em
[004](tickets/004-superficie-do-mcp.md) e [006](tickets/006-destino-da-timeline.md). As
respostas **não são inventadas**: cada uma foi extraída do dump real da Instaltech
(`Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221`, 94 workflows) rodando o auditor como biblioteca.
Onde a tool devolveria algo errado, o transcript mostra o erro — é para isso que ele existe.

---

## Transcript 1 — "O que acontece quando o contato ganha a tag `recuperacao-reativacao`?"

> **buscar**(loc="Xb9…", termo="recuperacao-reativacao")
> ```json
> {"tipo": "tag", "nome": "recuperacao-reativacao", "used_by": [], "orphan": true}
> ```

**Aqui o transcript já quebra.** A resposta está errada, e é a resposta que o código de
hoje devolve. Essa tag dispara `1 - Oportunidade Perdida -> Espera e Inicia reativação`,
que está **publicado**. O índice reverso do `build_dashboard` só varre os steps
(`_wf_refs`), nunca os triggers, então toda tag que só existe como gatilho é marcada como
órfã.

Não é um caso isolado: **6 das 59 tags que o dashboard chama de órfãs são gatilhos de
workflow** — `form-custom-site`, `gestor de follow up`, `ia manual`, `ia-teste`,
`indicacao-rodrigo` e `recuperacao-reativacao`.

Com o índice corrigido, a sessão seria:

> **buscar**(loc="Xb9…", termo="recuperacao-reativacao")
> ```json
> {"tipo": "tag", "nome": "recuperacao-reativacao",
>  "dispara": [{"workflow": "1 - Oportunidade Perdida -> Espera e Inicia reativação",
>               "id": "9fd53332…", "status": "published", "trigger": "Tag De Contato"}],
>  "adiciona": [], "remove": [], "condicao_em": []}
> ```
>
> **workflow**(loc="Xb9…", id="9fd53332…")
> ```json
> {"id": "9fd53332-ca74-4435-9f8c-f2b5060c49b7",
>  "name": "1 - Oportunidade Perdida -> Espera e Inicia reativação",
>  "status": "published", "n_steps": 90,
>  "triggers": ["Tag De Contato", "Status Da Oportunidade Alterado"],
>  "calls": ["1B - Não atendeu ligação -> Configura próxima etapa | Reativação"],
>  "called_by": ["1B - Não atendeu ligação -> Configura próxima etapa | Reativação"],
>  "has_entry": true,
>  "achados": [{"rule": "workflow_call_cycle", "severity": "WARN",
>               "detail": "ciclo de chamadas add_to_workflow: 1 - Oportunidade Perdida → …"}],
>  "caminhos": "- add tag reativacao/ia → Find Opportunity\n    - Opportunity Found → yes\n …"}
> ```

O inventário desse workflow custa **155 tokens**. A árvore de caminhos dele custa 6.772 —
é um dos grandes, 90 steps, contra 173 de mediana. A tool precisa de um teto e de um modo
resumido, senão um workflow gordo estoura sozinho o que o [001](tickets/001-o-que-o-dump-ja-responde.md)
economizou.

O agente responde: a tag dispara um workflow publicado que procura a oportunidade, espera,
manda WhatsApp e pode fazer ligação por IA, e no fim joga o contato em `1B`, que chama de
volta — um ciclo que a auditoria já sinaliza como WARN.

Tools usadas: `buscar`, `workflow`.

---

## Transcript 2 — Auditar subconta nova

> **dumps**()
> ```json
> [{"loc": "Xb9gDxwxYhdqtprGcb5E", "snapshots": ["2026-07-30_1221"]}, …]
> ```
>
> **achados**(loc="Xb9…", severidade="ERROR")
> ```json
> {"counts": {"ERROR": 20, "WARN": 5, "INFO": 127},
>  "achados": [{"rule": "broken_field_ref", "workflow_name": "Automação - Classificação Cliente | DM INSTA | VENDAS",
>               "detail": "step 'Update contact field' usa custom field inexistente: 'Possui time comercial?' (id k0F6L3qYBKQt3jssxjzs)"}, …]}
> ```

Os 20 ERROR custam **1.921 tokens** — cabem inteiros. O filtro por severidade é o que
torna isso possível: sem ele são 152 achados, e 94 deles são `naming_convention`, que
afogam o que importa.

Duas coisas que o transcript revela na forma da resposta. Os achados vêm **repetidos por
step** — o mesmo campo quebrado aparece quatro vezes no mesmo workflow. A tool deve
agrupar por `(rule, workflow, detail)` e devolver uma contagem, não quatro linhas iguais.
E `counts` precisa vir sempre, mesmo com filtro, senão o agente não sabe o que não pediu.

> **achados**(loc="Xb9…", severidade="WARN")
> ```json
> {"achados": [{"rule": "workflow_call_cycle", "workflow_name": "2A - Configurador de etapas", …},
>              {"rule": "workflow_unreachable", "workflow_name": "Handoff",
>               "detail": "workflow vazio (0 steps), sem trigger e não é chamado por nenhum outro"}]}
> ```

Tools usadas: `dumps`, `achados`.

---

## Transcript 3 — Documentar a operação para o cliente

> **inventario**(loc="Xb9…")
> ```json
> {"summary": {"workflows": 94, "published": 28, "draft": 66, "tags": 95, "tags_orphan": 59,
>              "fields": 165, "fields_orphan": 134, "pipelines": 4, "users": 10,
>              "calendars": 17, "custom_values": 25, "cv_orphan": 16}, …}
> ```

O inventário inteiro custa 20.111 tokens; só o `summary` custa 82. **O default tem que ser
o resumo**, com as fatias pedidas por demanda — o agente que documenta começa pelo mapa,
não pelos 94 workflows.

> **inventario**(loc="Xb9…", fatia="workflows")   → 10.674 tok, 94 itens a 130 cada
> **jornada**(loc="Xb9…")
> ```json
> {"meta": {…}, "criacao": [], "anytime": [18 raízes], "truncated": true}
> ```

`criacao` volta **vazia**: nenhum trigger `contact_created` nesta subconta. O contato não
entra por criação, entra por tag, por resposta e por ligação. Para documentar a operação
isso é a informação mais valiosa da sessão, e nenhuma outra tool a entrega.

É também onde a navegação por nível se prova necessária: das 18 raízes, 17 têm 37 tokens e
uma tem 214.545.

Tools usadas: `inventario`, `jornada`.

---

## Transcript 4 — Diagnosticar um contato

> **contato**(loc="Xb9…", id="<contactId>", days=60)
>
> *(abre Chrome, recaptura os dois tokens, pagina `audit/search/v2` + oportunidades +
> agendamentos — a única tool que espera segundos em vez de milissegundos)*

**Este transcript não pode ser escrito com honestidade ainda.** O
[006](tickets/006-destino-da-timeline.md) registrou a lacuna: o comando abre sessão
autenticada em produção e não foi executado, então não existe número para o tamanho da
resposta nem para a espera.

O que o transcript revela mesmo sem os dados: a resposta é uma lista de eventos ordenada no
tempo, e o campo que a torna útil é o `source` — `WORKFLOW_NEW` com `sourceId` igual ao id
do workflow causador. **É esse campo que costura esta tool às outras sete**: o agente lê
"tag adicionada por WORKFLOW_NEW/9fd53332", chama `workflow("9fd53332…")` e explica por
quê. Sem resolver o `sourceId` para nome, a resposta é uma lista de ids.

Tools usadas: `contato`, e `workflow` logo em seguida.

---

## O que o protótipo decidiu

**`validacao` não precisa existir.** É a tool que nunca aparece num transcript, e a leitura
do código explica: `_camada1` é literalmente `rules.run_all(ctx)`, o mesmo que `achados`
devolve; `_camada2` é `enumerate_paths` por workflow, o mesmo que `workflow` devolve; e
`camada3` são os contratos, 7 tokens e vazia sem a pasta `contracts/`. Manter a tool é
manter duas portas para o mesmo dado, com 120.506 tokens de superfície e nenhuma pergunta
que só ela responda. **Isso contraria a decisão do 004**, que a incluiu antes de medir a
sobreposição — a decisão de incluir `jornada` continua de pé, e é o transcript 3 que a
sustenta.

**`buscar` está errada e é código novo, não serialização.** Precisa de papel — quem
dispara, adiciona, remove e testa em condição —, e o índice reverso tem que varrer os
triggers além dos steps. Isso conserta de quebra um falso positivo que já está em produção
no `dashboard.html`: 6 tags marcadas como órfãs são gatilhos. É a primeira rachadura na
tese do [001](tickets/001-o-que-o-dump-ja-responde.md) de que o MCP é só recorte do que
existe. Uma rachadura pequena, e num lugar que já estava quebrado.

**`achados` precisa agrupar**, não só filtrar: o mesmo achado aparece uma vez por step.

**`workflow` precisa de teto na árvore de caminhos.** Mediana 173 tokens, mas o workflow do
transcript 1 custa 6.772 e o maior do dump custa 18.665.

**`inventario` tem que devolver o `summary` por default** (82 tokens), com as fatias sob
demanda.

**`contato` precisa resolver `sourceId` para nome de workflow** na própria resposta, senão
a costura com as outras tools não acontece.

Nenhuma tool nova apareceu. Sete sobrevivem, uma sai.

## Verificação

```
cd auditor && D=../dumps/Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221
.venv/bin/python -c "
import json
from pathlib import Path
from automaster_audit.loader import load_dump
from automaster_audit.dashboard import build_dashboard
ctx = load_dump(Path('$D')); d = build_dashboard(ctx)
orfas = {t['name'] for t in d['tags'] if t['orphan']}
trig = {}
for wf in ctx.workflows:
    for t in wf.triggers:
        for c in t.get('conditions', []) or []:
            if 'tag' in str(c.get('field','')).lower() and isinstance(c.get('value'), str):
                trig.setdefault(c['value'].strip().lower(), []).append(wf.name)
print('orfas que sao trigger:', sorted(k for k in trig if k in orfas))
"
```
