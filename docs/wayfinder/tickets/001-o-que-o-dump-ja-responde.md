# 001 — O que o dump já responde

Map: [Automaster como plugin do Claude Code](../map-plugin-claude-code.md)
Type: `wayfinder:measure`
Status: fechado (2026-09-18)
Assignee: claude
Blocked by: —

## Pergunta

Das quatro perguntas de uso — auditar subconta nova, responder pergunta sobre automação,
diagnosticar um contato, documentar a operação — quais o dump atual já responde sem código
novo, e quantos tokens custa cada resposta hoje?

Contar sobre um dump real (Instaltech, 94 workflows): tamanho do `report.json`, tamanho do
dump inteiro, e para cada pergunta, quais arquivos o agente teria que ler.

O número que interessa: quanto do trabalho é consulta ao que já existe e quanto é código
novo. Se for quase tudo código novo, a decisão "MCP lê o dump direto" custa mais do que
parecia quando foi tomada.

## Resolução

Medição completa em
[medicao-001-o-que-o-dump-ja-responde.md](../medicao-001-o-que-o-dump-ja-responde.md).

O dump bruto da Instaltech tem 1,73 milhão de tokens, 86% deles nos 94 workflows. Nada
disso cabe em contexto, e não precisa caber: `dashboard.build_dashboard(ctx)` já devolve
o inventário inteiro mais o índice reverso em **20.111 tokens**, e a seção de um workflow
no `paths.md` custa 173 tokens de mediana contra 6.291 do JSON dele.

Auditar subconta nova está respondida hoje: `report.md`, 6.056 tokens, cabe inteiro.
Responder pergunta sobre automação está meio respondida — localizar por `grep` é barato,
ler o workflow é caro, e é exatamente o que o MCP barateia. Documentar a operação não tem
artefato textual, mas cai de 1,49 M para uns 100 mil tokens com o que já existe.

**A decisão "MCP lê o dump direto" custa menos do que parecia, não mais**, desde que o MCP
importe o auditor como biblioteca em vez de ler os JSON por conta própria. O código novo
das três primeiras perguntas é serialização e recorte, não lógica.

O custo caro está isolado na quarta: diagnosticar um contato é código novo de ponta a
ponta. Nenhum dump tem contato, timeline ou oportunidade, e a timeline do extractor é
efêmera — escreve HTML em `os.tmpdir()` e não persiste JSON. Isso é o ticket 006, e não
tem relação com a superfície do MCP sobre o dump.

## Verificação

Na seção `## Verificação` do documento de medição.
