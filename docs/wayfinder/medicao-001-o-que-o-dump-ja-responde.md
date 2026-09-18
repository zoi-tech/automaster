# Medição 001 — O que o dump já responde, e a que custo de tokens

Método: dump real da Instaltech `dumps/Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221/`, 94 workflows,
extraído em 2026-07-30. Os seis artefatos do auditor foram regerados em 2026-09-18 com
`auditor/.venv/bin/automaster-audit {audit,paths,dashboard,graph,journey}`. Tokens contados
com `tiktoken`/`cl100k_base` sobre o texto do arquivo — não é o tokenizador da Anthropic,
mas erra por poucos porcento e serve para comparar ordens de grandeza.

## Tamanho do que existe hoje

| Arquivo | bytes | tokens |
|---|---|---|
| `manifest.json` | 197 | 88 |
| `pipelines.json` | 9.479 | 3.047 |
| `tags.json` | 20.642 | 8.865 |
| `users.json` | 29.269 | 7.745 |
| `calendars.json` | 104.338 | 27.079 |
| `custom_fields.json` | 128.033 | 40.690 |
| `custom_values.json` | 596.190 | 148.588 |
| `workflows/` (94 arquivos) | 5.250.271 | **1.490.561** |
| `report.md` | 20.360 | 6.056 |
| `report.json` | 40.106 | 13.954 |
| `paths.md` | 312.172 | 83.501 |

Dump bruto inteiro: 6,1 MB, **1,73 milhão de tokens**. Não cabe em contexto nenhum, e 86%
disso são os workflows.

Um workflow avulso: menor 886 tokens, mediana 6.291, p90 38.833, maior 118.982. Ler três
workflows grandes já passa de 100 mil tokens.

Os três HTML são para humano e não entram na conta de tokens do agente: `dashboard.html`
190 KB, `graph.html` 168 KB, `journey.html` 1,9 MB.

## O inventário já existe em Python, e é barato

`dashboard.build_dashboard(ctx)` devolve um `dict` com o inventário completo mais o índice
reverso entidade → workflows, antes de virar HTML. Serializado em JSON:

| Fatia | itens | tokens |
|---|---|---|
| tudo | — | **20.111** |
| `summary` | — | 82 |
| `workflows` | 94 | 10.674 |
| `tags` | 95 | 2.986 |
| `fields` | 165 | 3.976 |
| `pipelines` + `users` + `calendars` + `custom_values` | 56 | 2.371 |

Um workflow do inventário (id, nome, status, nº de steps, triggers, canais, contagem de
tags e campos, quem ele chama, quem o chama, tem entrada) custa **130 tokens**. A lista
crua dos 94 com id, nome, status e `has_entry` custa 5.349.

Ou seja: o inventário inteiro da subconta — 1,73 M de tokens de dump bruto — já está
reduzido a 20 mil tokens por código que existe. A redução é de 86 vezes, e nenhuma linha
dela é nova.

`paths.md` tem a mesma propriedade: 83.501 tokens no total, mas a seção de um workflow tem
mediana de **173 tokens**, p90 1.357, máximo 18.665. `build_paths_report` já monta por
workflow; o que falta é devolver uma seção em vez do arquivo.

## As quatro perguntas

**Auditar subconta nova — respondida hoje, sem código novo.** `report.md` tem 6.056 tokens
e cabe inteiro no contexto. `report.json` custa 13.954 para a mesma informação, e não
compensa: é uma lista plana de achados, com `workflow_name` repetido em cada linha e nenhum
agrupamento. Para o agente, `report.md` é a leitura certa. O que falta é uma filtragem por
severidade — 20 ERROR, 5 WARN, 127 INFO, e os 127 INFO são a maior parte do arquivo.

**Responder pergunta sobre automação — meio respondida, e é onde o custo mora.** Localizar
é barato: `grep` nos 94 arquivos acha o workflow que mexe numa tag por alguns tokens. Ler é
caro: para dizer o que o workflow faz, hoje o caminho é o JSON inteiro, mediana 6.291 e p90
38.833 tokens. A seção do `paths.md` responde a mesma pergunta por 173 tokens de mediana,
mas só existe dentro de um arquivo de 83 mil que o agente teria que ler inteiro para
recortar. Esta é a pergunta que o MCP resolve, e resolve com pouco código.

**Diagnosticar um contato — não respondida, e o dado nem é gravado.** Nenhum dump em
`dumps/` tem contato, timeline ou oportunidade: só workflows e as seis entidades. A timeline
existe no extractor (`timeline_html.ts`, comando `timeline`) e é **efêmera** — escreve um
HTML em `os.tmpdir()` e não persiste JSON nenhum. Responder isso é código novo de ponta a
ponta: persistir a timeline no dump, ou chamar a API ao vivo. É o ticket 006.

**Documentar a operação — não respondida.** Não há artefato textual que descreva a operação;
o que existe são os três HTML, feitos para olho humano. O agente que fosse escrever a
documentação teria que ler 1,49 M de tokens de workflows. Com o dict do `build_dashboard`
mais as seções do `paths.md`, o mesmo trabalho cabe em cerca de 100 mil tokens — ainda
grande, mas possível em pedaços.

## O número que o ticket pediu

Duas das quatro perguntas já estão respondidas pelo que existe: auditar (integral) e
responder sobre automação (localizar sim, ler não).

O código novo do MCP para as duas primeiras é **serialização e recorte**, não lógica:
`build_dashboard` e `build_paths_report` já produzem as estruturas certas em Python, e o
que falta é expor fatia por id e filtro por severidade. A decisão "MCP lê o dump direto"
custa **menos** do que parecia, não mais — desde que o MCP chame o auditor como biblioteca
em vez de ler os JSON do dump por conta própria.

O custo real está na terceira pergunta. Diagnosticar um contato é código novo inteiro, e
nada no dump ajuda. Se o plugin precisar responder essa pergunta na v1, ela é o item mais
caro do plano, e não tem relação com a superfície do MCP sobre o dump.

## Verificação

```
cd auditor && .venv/bin/pip install tiktoken
D=../dumps/Xb9gDxwxYhdqtprGcb5E/2026-07-30_1221
.venv/bin/automaster-audit audit $D && .venv/bin/automaster-audit paths $D
.venv/bin/python -c "
import json,tiktoken
from pathlib import Path
from automaster_audit.loader import load_dump
from automaster_audit.dashboard import build_dashboard
e=tiktoken.get_encoding('cl100k_base')
d=build_dashboard(load_dump(Path('$D')))
print(len(e.encode(json.dumps(d,ensure_ascii=False))))
"
```
