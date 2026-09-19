# Escrita e personalização visual de formulários e surveys — design

Data: 2026-09-19. Ciclo seguinte ao da leitura (plugin 0.11.0).

## Objetivo

Criar e editar formulários e surveys da subconta GHL pelo automaster, incluindo a
identidade visual de cada um — formulário sob medida por cliente, esteticamente
resolvido, não só funcional.

## Estado de partida

A leitura está no ar: módulo `extractor/src/api/forms.ts`, comando `npm run formularios`,
tool MCP `formularios`, `forms.json`/`surveys.json` no dump, regras `broken_form_ref` e
`unused_form`. Rotas de leitura em `docs/endpoints.md`, seção `## Formulários e surveys`.

Fato descoberto no brainstorming: a lista de formulários **não** traz o `formData`. O
documento vive num arquivo do Google Cloud Storage apontado por
`versionHistory[].formDataDownloadUrl`, com `versionId` e `version` incremental — o mesmo
arranjo dos steps de workflow. Editar um campo é, muito provavelmente, publicar uma
versão nova do documento inteiro, não um PATCH de campo. A pesquisa confirma.

## Recorte

Dentro: criar formulário e survey, editar estrutura (campos) e editar o visual, nos dois.

Fora: apagar formulário/survey, pastas de survey, migração entre subcontas, regra de
auditoria nova sobre formulário.

## Arquitetura

Abordagem escolhida: **documento inteiro, editado por patch declarativo**.

O automaster baixa o `formData` da versão atual, aplica uma lista de operações declaradas
(`adicionar campo`, `remover campo`, `renomear`, `reordenar`, `definir estilo`), valida o
documento resultante e republica o documento completo. A CLI e a tool MCP falam em
operações; nunca pedem JSON cru ao usuário. Campo que o automaster não modela sobrevive
intacto, porque o ponto de partida é sempre o documento real do servidor.

Descartadas: um schema próprio compilado para `formData` (perde tudo que não modela na
hora de republicar um formulário existente) e o cano cru que recebe `formData` pronto
(sem guarda contra documento inválido, e empurra o trabalho da feature para o usuário).

### Superfície

- `extractor/src/api/forms-write.ts` — módulo novo ao lado do `forms.ts` de leitura, que
  não muda.
- CLI: `npm run formulario-acao` (criar, editar estrutura, publicar) e
  `npm run formulario-estilo` (aplicar tokens visuais).
- MCP: tools `formulario_acao` e `formulario_estilo`, chegando a 27.
- Versão do plugin: 0.12.0, com entrada no `CHANGELOG.md`.

### Ciclo de edição

1. Baixa a versão atual do `formData`.
2. Aplica as operações declaradas.
3. Valida o documento resultante.
4. Grava o documento antigo em `<dumps>/_formularios/<loc>/<formId>/<ts>.json`.
5. Publica, exigindo `--confirmo` / `confirmo=true`.

Sem `--confirmo`, o comando imprime o que mudaria e para. Survey roda o mesmo ciclo, com
o seu próprio `fieldCSS`.

Restaurar versão anterior não entra neste ciclo: o snapshot existe para permitir a
restauração manual, e o `versionHistory` do GHL é o caminho para automatizá-la depois.

## Personalização visual

O `impeccable` roda num recorte fechado: entra a marca do cliente, sai um conjunto de
tokens — cor, tipografia, escala de espaçamento, radius, estados de foco e de erro — que
o automaster traduz para o bloco de estilo do formulário. O `impeccable` não produz o
`formData`; a geração de design fica separada da mecânica de publicação.

Piso não negociável, porque formulário é a porta de entrada do lead: contraste WCAG AA,
alvo de toque mínimo, foco visível de teclado, estado de erro legível sem depender de cor.

### Aprovação visual

Publica num formulário descartável da subconta de validação, abre a URL pública real pelo
Playwright e tira screenshot. Itera ali. Aprovado, o mesmo conjunto de tokens é aplicado
no formulário de produção. Não há render local: a fidelidade do render próprio ao do GHL
não é verificável, e a página pública é.

## Verificação

- Toda operação validada ao vivo num formulário e num survey criados e apagados na hora,
  na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), sem resíduo na subconta.
- Testes no auditor para o motor de operações e para a tradução de tokens em CSS:
  `.venv/bin/python -m pytest -q`.
- `npx tsc --noEmit` no extractor.
- A subconta `WPIUKW3L4lDyMhLhKYKG` devolve 401 e não serve de cobaia.

## A resolver na pesquisa

1. Rotas de escrita de formulário e de survey (criar e atualizar).
2. Como o `formData` é enviado: corpo da requisição, ou upload para o Cloud Storage
   seguido de referência ao `versionId`.
3. Onde o formulário guarda o estilo. No survey é `formData.fieldCSS`; no formulário,
   desconhecido.
4. A URL pública do formulário, para o screenshot.
5. O vocabulário de campo do `formData`: tipos, obrigatoriedade, vínculo com custom field
   do contato.
6. Quanto do `impeccable` reaproveitar — skill nova, sub-skill ou só um conjunto de
   presets de tokens.

Técnica disponível: baixar o bundle público do app
(`appcdn.leadconnectorhq.com/crm/<app>/<build>/static/js/*.js`) com `curl -A` de browser.
Foi assim que saíram os mapas de conversas e de oportunidades.
