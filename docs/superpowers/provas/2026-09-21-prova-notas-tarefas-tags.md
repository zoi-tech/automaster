# Prova ao vivo — notas, tarefas e tags (0.20.0)

Subconta Instaltech `Xb9gDxwxYhdqtprGcb5E`, contato de teste `uWqujqll20tRuglV3mLt`,
2026-09-21. Um comando por vez (escrita ao vivo é serial). Resíduo zero.

## Notas do contato

Criar, editar e apagar rodaram inteiros. Nota `FFn42BFwiyOk8DeqNRy9`, criada, editada e
apagada.

O POST devolve a nota dentro de `{note: {...}}`. **Não foi possível ver o código HTTP**: o
`GhlClient` devolve o corpo já decodificado e descarta o status. A pergunta "o POST responde
201?" continua sem prova direta, mas nada depende dela — o cliente trata qualquer 2xx igual.

**`title` e `color` NÃO voltam na leitura.** `pinned` volta, sempre `false` na criação sem o
campo. A resposta traz também `bodyText`, `userId` (o dono da sessão), `dateAdded`,
`relations` e `attachments`, nenhum deles na doc.

O DELETE devolve as duas grafias: `{"succeded":true,"succeeded":true}`.

## Tarefas do contato

Tarefa `muVG041HsJJ8ZCg50xKf`: criada sem `--dono`, lida, concluída, reaberta e apagada.

**Tarefa criada sem `assignedTo` fica mesmo sem responsável.** O servidor não atribui
ninguém: o campo não aparece na resposta do POST nem na leitura do contato, e sai `null` na
busca por subconta. Outras tarefas reais da Instaltech também estão assim, então é estado
normal, não defeito. Pergunta do dossiê fechada.

A criação manda `completed: false` pela CLI, sem o usuário pedir — é campo obrigatório no
POST. Como a CLI sempre o preenche, o 4xx da ausência nunca aparece na prática.

Concluir e reabrir usam a rota `/completed` e devolvem a tarefa inteira com o novo
`completed`. Apagar devolve as duas grafias de sucesso.

**Fato novo: o índice da busca por subconta fica defasado.** Logo depois do DELETE, a tarefa
apagada ainda voltava em `POST /locations/<loc>/tasks/search`, com `deleted: false`, enquanto
`GET /contacts/<id>/tasks` já a tinha removido. A leitura por contato é a fonte confiável;
a busca é índice, e demora a acompanhar.

A busca também enriquece o que a leitura por contato não traz: `assignedToUserDetails`,
`contactDetails`, `status`/`statusGroup` e `searchAfter` para paginação.

## Tags da subconta

Tag descartável `zz-prova-020` (`T5pXPTObgm7T2gZgVBfC`): prévia, criação, renomeação para
`zz-prova-020b` e exclusão. `tags --termo zz-prova` voltou vazio ao fim. Nenhuma das 126 tags
reais foi tocada.

A guarda de nome duplicado dispara sem distinguir maiúscula: `criar --nome ZZ-PROVA-020`
recusou porque `zz-prova-020` já existia.

O POST de tag devolve só `{id, name}` depois da normalização; a renomeação devolve o mesmo
envelope com o nome novo.

## Tools MCP

`tags` contra o dump `2026-09-20_0856`: 126 tags ao vivo, **42 com citação em workflow**. A
mais citada é `ia - ativa`, em 9 workflows, nos papéis `adiciona`, `condicao` e `remove`.

A declaração do furo do merge field apareceu: a Instaltech tem step que escolhe a tag por
`customTags`, então a resposta avisa que a contagem é incompleta por natureza.

**A degradação sem dump foi provada** apontando `AUTOMASTER_DUMPS` para a pasta `dumps/` do
repo, que não tem a Instaltech: a lista saiu inteira, com `workflows: null` e o aviso
explicando o que falta, em vez de falhar.

**A guarda do apagar recusou** `tag_acao(acao="apagar", tag="ia - ativa", confirmo=True)`,
nomeando os 9 workflows e os papéis. Não foi repetida com `apagar_citada=true` — a recusa é o
teste, e apagar uma tag real da Instaltech seria estrago de verdade.

`anotacao_acao` sem `confirmo` devolveu `aplicado: false` com o corpo que iria para o
servidor.

## Correção que a prova forçou

Com `--json` os quatro comandos novos imprimiam JSON indentado, e `_run_extractor` lê só a
última linha do stdout — toda tool MCP quebrava com `JSONDecodeError`. Passaram a imprimir em
uma linha quando `--json`, como o resto da CLI.
