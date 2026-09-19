# Pesquisa — oportunidades no MCP automaster

Spec: `docs/superpowers/specs/2026-09-19-oportunidades-mcp-design.md`

## Achados

### A1 — Não há um host errado: são dois sistemas de auth diferentes
`backend.leadconnectorhq.com/opportunities/*` é a API interna do app, e exige os dois
tokens (Bearer + `token-id` Firebase). `services.leadconnectorhq.com/opportunities/*` é a
API pública Marketplace v3, documentada, que aceita só Bearer de OAuth ou PIT — outro
esquema de credencial inteiramente. O mesmo host `services` também serve rotas internas
(tags), então o host sozinho não diz qual auth usar; a rota diz.
- Fonte: `extractor/src/api/entities.ts:7`, `docs/endpoints.md:17,21-24`, doc v3 em `ghl/opportunities/`
- Contradiz a spec: parcial — a spec trata como "um dos dois está errado"
- Pergunta: a ferramenta vai falar com o app pelo mesmo caminho de sempre (sessão Chrome,
  dois tokens), ou vai passar a usar a API pública, que precisa de uma credencial que a
  subconta ainda não tem configurada e que o projeto já descartou para workflows?

### A2 — O CRUD de card inteiro existe e está documentado na API pública v3
Criar: `POST services.../opportunities/` com `pipelineId`, `locationId`, `name`, `status`,
`contactId` obrigatórios; `pipelineStageId`, `monetaryValue`, `assignedTo`,
`forecastExpectedCloseDate`, `forecastProbability`, `customFields` opcionais. Editar:
`PUT /opportunities/:id`, nenhum campo obrigatório. Existem ainda Update Status, Upsert,
Delete, Get e Search.
- Fonte: doc v3, `create-opportunity.md:801-823`, `update-opportunity.md:1433-1452`
- Contradiz a spec: não — fecha o ponto aberto Q2
- Pergunta: nenhuma, se A1 resolver pelo caminho público

### A3 — Mover de estágio não tem rota própria
É o mesmo `PUT /opportunities/:id` da edição, trocando `pipelineStageId`. Não existe
endpoint "move" ou "transition" na tabela de endpoints v3.
- Fonte: doc v3, `ENDPOINTS.md` (Create, Update, Update Status, Upsert, Delete, Get, Search)
- Contradiz a spec: não — fecha o ponto aberto Q3
- Pergunta: nenhuma

### A4 — Trocar o contato de uma oportunidade não é possível pela edição
O schema do `PUT /opportunities/:id` não tem `contactId`. O vínculo só se define na criação.
- Fonte: doc v3, `update-opportunity.md:884`
- Contradiz a spec: parcial — a spec lista "editar (nome, valor, contato, dono)"
- Pergunta: vincular a outra pessoa vai exigir apagar o card e criar de novo, perdendo o
  histórico dele. Isso fica de fora da ferramenta, ou entra com esse aviso?

### A5 — Escrita de pipeline não existe na API pública, só no app
A doc v3 tem exclusivamente `GET /opportunities/pipelines`. Nenhum POST, PUT ou DELETE de
pipeline nos 18 arquivos da referência. As rotas de escrita de pipeline vêm do bundle do
app, ou seja, são internas e não documentadas.
- Fonte: doc v3, `ghl/opportunities/pipelines.md`; rotas de bundle registradas em sessão anterior
- Contradiz a spec: parcial — a spec assume as duas metades no mesmo caminho
- Pergunta: metade do trabalho (cards) tem contrato escrito e estável; a outra metade
  (pipelines) só tem o que se leu do código do site, que muda sem aviso. Vale prender as
  duas na mesma entrega, ou a gestão de pipeline sai numa rodada própria?

### A6 — O comportamento perigoso do PUT de pipeline continua sem fonte
Se o PUT exige a lista inteira de estágios (e portanto omitir um apaga), se existe rota
por estágio, e o que acontece com cards num estágio apagado: nenhuma das três tem fonte.
A tentativa de rebaixar o bundle falhou — o build citado na memória já não resolve no CDN,
e o S3 não lista. Descobrir a URL do bundle atual exige abrir o app com Playwright.
- Fonte: tentativa registrada; `appcdn.leadconnectorhq.com/crm/*/2567/*` devolve `NoSuchKey`
- Contradiz a spec: parcial — a spec assume o bundle como atalho barato
- Pergunta: fechar isso custa uma sessão de browser aberta contra a conta real. Aceita
  esse passo, ou a gestão de pipeline sai do escopo por não ter como ser provada barato?

### A7 — Ler pipelines já existe no extractor
`fetchPipelines(client, locationId)` já faz exatamente a leitura que a spec descreve como
operação nova, no host `backend`.
- Fonte: `extractor/src/api/entities.ts:6-9`
- Contradiz a spec: parcial — a spec cria um módulo novo sem citar a função existente
- Pergunta: nenhuma, é uma correção — a operação de listar pipelines reusa o que existe

### A8 — O rastro em disco já tem função pronta
`registroEscrita(loc, pasta, chave, dados)` grava em `<dumps>/<pasta>/<loc>/<chave>/<ts>.json`.
Basta chamar com `pasta="_oportunidades"`. O snapshot antes/depois de contato tem um
segundo padrão, mais rico, com diff.
- Fonte: `extractor/src/cli.ts:498-505`; snapshot de contato em `cli.ts:383-389,404-410`
- Contradiz a spec: não — é reuso, não mecanismo novo
- Pergunta: nenhuma

### A9 — Adicionar tool é uma entrada num dict só
`TOOLS` em `mcp_server.py:543-668` serve de catálogo e de dispatch ao mesmo tempo. Nenhum
teste afere a contagem total. Nada quebra ao acrescentar.
- Fonte: `mcp_server.py:543-668,671-674,695-703`; `tests/test_mcp_tools.py:188-194`
- Contradiz a spec: não
- Pergunta: nenhuma

### A10 — Três lugares descrevem as tools por nome e já estão desatualizados
A descrição do plugin ainda fala em "oito tools" e não foi atualizada em três releases. O
frontmatter da skill de leitura enumera as tools nominalmente — tool fora dessa lista não
dispara a skill. A spec não menciona nenhum dos dois, nem a entrada de CHANGELOG que o
repo exige por release.
- Fonte: `.claude-plugin/plugin.json:3`; `skills/automaster-leitura/SKILL.md:2`; `CHANGELOG.md:7-19`
- Contradiz a spec: parcial — falta de escopo, não erro
- Pergunta: nenhuma, entra no plano como tarefa

## Fila do grill

1. A1 — sessão Chrome ou credencial pública? (trava A2, A3, A5)
2. A5 — pipeline junto ou em rodada separada? (trava A6)
3. A6 — aceita abrir o browser contra a conta real para provar o PUT de estágio?
4. A4 — trocar contato do card fica fora, ou entra com o aviso de que recria o card?
