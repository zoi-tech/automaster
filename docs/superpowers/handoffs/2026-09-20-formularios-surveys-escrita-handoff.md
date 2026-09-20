# Escrita de formulários e surveys — o que foi decidido durante a execução

Ramo `formularios-escrita`, 26 commits, `5feb874`..`4e92eee`. Plano executado:
`docs/superpowers/plans/2026-09-19-formularios-surveys-escrita.md`.

Este arquivo guarda o que não cabe na mensagem de commit nem no `docs/endpoints.md`:
as decisões tomadas contra o texto do plano, o que ficou por fazer, e a única pergunta
que precisa de uma pessoa na interface do GHL.

## O que o plano supunha e a realidade desmentiu

O plano foi escrito antes de qualquer documento real ser examinado. Cinco premissas dele
caíram, todas descobertas durante a execução:

1. **O documento não vem embutido na resposta.** `carregarDoc` como o plano escrevia
   estourava em todo formulário real; o documento vem da URL pública do `versionHistory`,
   baixada sem auth. Foi o primeiro bug load-bearing.
2. **`fieldCSS` e `mobileFieldCSS` ficam na RAIZ no survey** e dentro de `form` no
   formulário. A guarda do plano só pegava a segunda forma — ou seja, deixava passar
   exatamente o caminho que existe no survey.
3. **O botão de envio não existe no survey.** No formulário é `{tag:"button",
   type:"submit"}`; no survey o `button` do slide é objeto de estilo. A validação do plano
   recusava toda edição de survey.
4. **As chaves da paleta eram outras.** `GET /forms/default-colors` devolve
   `{"colors":[{"name","value"}]}` com rótulo livre, não o objeto de chaves fixas.
5. **`networkidle` nunca resolve** na página pública do widget: o screenshot do plano
   estourava 30 s toda vez.

E o bloqueio declarado do plano — o formato da lógica condicional entre slides, que
exigiria o usuário na interface — foi dissolvido baixando os 29 documentos de survey da
Instaltech das URLs públicas do Cloud Storage. O formato é `form.conditionalLogic`.

## Decisões tomadas contra o texto do plano

- `validar` pula a checagem de botão de envio quando `ehSurvey(doc)` — no survey o botão de navegação mora em `slide.button`, não na lista de campos — porque, como está no plano, TODO teste de survey da T2 estoura "sem botão de envio" — custo se errado: um survey poderia ser publicado sem meio de avançar, baixo porque `criar-slide` já copia o `button` do slide anterior.
- em `validar`, a checagem de slides vem ANTES da de campos — porque o teste "remover o último slide é recusado" exige a mensagem "sem nenhum slide" e a ordem do plano devolveria "sem nenhum campo" — custo se errado: nenhum, só a mensagem de erro.
- `carregarDoc` (T4) cai para a última `versionHistory[].formDataDownloadUrl`/`surveyDataDownloadUrl` via `baixarVersao` quando a resposta não traz `formData`/`surveyData` inline, em vez de estourar — porque a pesquisa registrou as duas formas e o import de `baixarVersao` ficaria morto sem isso — custo se errado: uma chamada HTTP a mais.
- T2b (lógica condicional entre slides) fica por último, depois da T8 — porque depende de o usuário montar uma regra na interface do GHL, e travar a fila nisso custa a sessão inteira — custo se errado: nenhum; a operação é aditiva ao tipo `Op`.
- o bloqueio da T2b está DISSOLVIDO sem a interface do GHL — o formato saiu dos 29 documentos de survey da Instaltech baixados das URLs públicas do Cloud Storage — custo se errado: nenhum, é leitura; a T2b volta para a posição original na fila.
- `CAMINHO_PROIBIDO` do motor (T2) passa a pegar também `fieldCSS`/`mobileFieldCSS` na RAIZ do documento, não só sob `form.` — porque nos 29 documentos reais eles estão no topo, e a regra do plano (`/^form\.(mobileF|f)ieldCSS$/`) deixaria passar exatamente o caminho que existe — custo se errado: um `definir` legítimo nesses caminhos seria recusado, o que é o comportamento desejado de qualquer jeito.
- o `IGNORAR` de `diff.ts` (T3) inclui `fieldCSS` e `mobileFieldCSS` na raiz além de `form.fieldCSS`/`form.mobileFieldCSS` — mesma razão do ruling anterior: nos documentos reais eles estão no topo, e são blocos de CSS enormes que afogariam a prévia — custo se errado: nenhum.
- `extractor/tsconfig.json` fica como está (`include: ["src/**/*.ts"]`, `rootDir: "src"`) e os arquivos de `extractor/test/` NÃO entram no typecheck — porque incluí-los quebra o `rootDir` e o `tsx --test` já os executa de verdade, que é a checagem que importa — custo se errado: um erro de tipo só no arquivo de teste passaria pelo `tsc` e apareceria como falha do `npm test`.
- o `criar-slide` copiando o `button` do slide anterior NÃO é escopo extra — está no código do próprio plano, verbatim — mas entra na rodada de correção como teste faltando — custo se errado: nenhum, só um teste a mais.
- `definir-logica` NÃO leva o campo `slide` — nem obrigatório, nem opcional-ignorado — porque parâmetro aceito e silenciosamente ignorado faz o chamador acreditar que restringiu a lógica a um slide quando escreveu no documento inteiro; o `slide: string` do plano supunha um caminho por slide que as 29 amostras não têm — custo se errado: se o GHL tiver mesmo lógica por slide em algum lugar não amostrado, a operação precisa de um campo novo depois.
- o achado 2 é corrigido em `doc.ts` (Tarefa 2, já fechada) e não na casca da Tarefa 4 — porque é onde o defeito mora, e consertar só o chamador deixaria todos os outros chamadores quebrados — custo se errado: o diff da Tarefa 4 encosta num arquivo de outra tarefa, o que o histórico registra.
- `paleta-gravar` MESCLA a paleta em vez de substituí-la, e a mescla vira função pura testada em `style.ts` — porque documentar o risco não o elimina, e mesclar é inofensivo mesmo se o servidor já mesclasse sozinho — custo se errado: envio redundante de entradas que o servidor manteria de qualquer jeito.
- a espera do screenshot troca `networkidle` por `domcontentloaded` + `waitForSelector("form, input, button", 15s)` + 1500 ms de assentamento, e ESTOURA em vez de fotografar se nada renderizar — porque o código do plano sempre falha na página real, e uma foto em branco aprovada como "ficou bom" é o defeito que este comando existe para evitar — custo se errado: a espera fixa pode ser curta para página muito lenta, o que aparece como foto incompleta, não como erro silencioso.
- os testes de guarda do plano são corrigidos em vez de aceitos — o plano é um argumento, não um contrato, e um teste de guarda que não prova que a chamada não aconteceu não testa a guarda — custo se errado: nenhum, três asserções a mais.
- a rodada 2 foi verificada por mim, com grep e a suíte inteira, em vez de por um re-revisor despachado — porque o achado era a presença de uma asserção literal, que um grep resolve, e um subagente para reler cinco linhas é desperdício — custo se errado: perdi o olhar de terceiro num diff de três linhas aditivas.
- o Menor da skill — ela diz que a paleta mescla, mas não diz que, se a leitura da paleta atual falhar, o CLI cai para substituição com um aviso — é corrigido na Tarefa 10, junto com a passagem de documentação, e não numa rodada própria — porque é uma frase, e a Tarefa 10 já abre os mesmos arquivos de texto — custo se errado: se a Tarefa 10 esquecer, a frase não entra; por isso está escrita aqui.
- o contato de teste `ZlkU3kiMDr0xiIGLiMC5`, criado no CRM do cliente pela submissão pública, NÃO é apagado (desfazer contato é fora de escopo do projeto) mas recebe a tag `teste-automaster` e é nomeado em `docs/endpoints.md` — porque resíduo anônimo num CRM de cliente é pior que resíduo identificado — custo se errado: uma tag a mais num contato de teste.
- a cegueira da prévia a operações de slide é corrigida agora, e não deixada como débito — porque a prévia é a única coisa entre o operador e uma escrita sem desfazer numa subconta de cliente, e uma prévia que mente por omissão é pior que prévia nenhuma — custo se errado: linhas a mais na prévia de um survey.
- o lado formulário é REFEITO em série, não anotado como "prova de confiabilidade reduzida" — porque a lição que a própria tarefa documentou é que escrita ao vivo é serial por construção, e apoiar a prova na violação dessa regra torna o documento incoerente com o que ele ensina; e custa um formulário descartável — custo se errado: mais uma passagem de escrita numa subconta de cliente, em série e com resíduo conferido.
- as duas rotas sem prova (temas, duplicar survey) são PROVADAS em vez de removidas da tabela — `temas` é leitura e não custa nada, e duplicar o survey descartável é uma chamada a mais no que já vai ser feito — custo se errado: nenhum.
- a submissão pública NÃO é refeita — criaria outro contato no CRM do cliente; a prova de lá fica, marcada como vinda da passagem concorrente — custo se errado: essa prova específica continua com a confiabilidade da passagem contaminada.
- os dois residuais são CORRIGIDOS numa segunda passagem, em vez de subirem ao usuário como pendência, contra a regra de "uma onda só" da skill — porque são dois itens nomeados e pequenos, um deles é o buraco restante do invariante que a própria onda foi corrigir, e o outro deixa o achado Crítico sem guarda de regressão; e porque o usuário pediu explicitamente nenhuma ponta solta — custo se errado: uma rodada a mais de churn no fim do ramo.
- a verificação desta segunda passagem é feita por mim, por mutação e pela suíte, em vez de por mais um re-revisor despachado — porque os dois achados têm critério binário e mecânico (o teste morde ou não morde) e eu posso rodar a mutação eu mesmo — custo se errado: perdi o olhar de terceiro num diff pequeno.

## O que ficou por fazer

Nada disso bloqueia o uso; tudo foi triado na revisão final como "pode esperar".

- **A pergunta que precisa de uma pessoa:** o builder do GHL preserva `customStyle` e
  `fieldStyle` depois de alguém abrir o formulário na interface e salvar? Exige abrir um
  formulário de teste na tela, mexer, salvar, e baixar o documento de novo. O roteiro está
  em `docs/endpoints.md`.
- **Duas anomalias do servidor do GHL, sem causa identificada, possivelmente a mesma:**
  `POST /surveys/duplicate/<id>` devolve 200 com documento coerente e nada fica acessível
  por `GET` ou listagem; e um survey lido com sucesso devolveu "already deleted" segundos
  depois, sem `DELETE` anterior. Daí a recomendação, já no `docs/endpoints.md`: confirme
  com um `GET` depois de qualquer escrita de survey.
- `npm run formularios -o submissoes` sem `--limite` devolve 422 nos dois hosts. Bug de
  leitura anterior a este ramo; o contorno está documentado.
- `adicionar-campo` num survey sem slide nenhum estoura TypeError, enquanto
  `reordenar-campos` no mesmo caso dá erro em português. Assimetria anterior a este ramo.
- Nenhum teste exercita `runFormularioAcao`/`runFormularioEstilo`: a fiação CLI→JSON→MCP é
  verificada por leitura. Duas funções puras (`saidaPaletaGravar`, `resolverPaleta`) foram
  extraídas para que o achado Crítico da paleta tenha teste que morde, mas o resto da casca
  não tem rede.
- `FORM_ACOES`/`ESTILO_ACOES` existem em TypeScript e em Python com conteúdos de propósito
  diferentes (o MCP acrescenta `previa`), sem teste que case as duas listas: ação nova no
  CLI fica invisível no MCP em silêncio.
- O retry pós-criação repete qualquer falha 3 vezes, inclusive 401. Custa 3 s, não engole
  o erro.
- O id de slide que a prévia de `criar-slide` mostra nunca é o id gravado no `--confirmo`:
  cada chamada gera um `Date.now()` próprio.

## Resíduo na subconta de validação

Zero em formulário e survey, conferido lendo o JSON completo das duas listagens em cada
rodada de escrita.

Sobrou um contato no CRM da Instaltech: `ZlkU3kiMDr0xiIGLiMC5`, criado pela submissão de
teste na página pública, marcado com a tag `teste-automaster`. Não foi apagado porque
desfazer contato está fora do escopo do projeto.

E um id de survey que o servidor devolveu num 200 sem gravar nada acessível:
`u0WIsApG4MDPfCDqcFRf`. Pela API ele não existe; se alguém quiser certeza, a interface é o
único lugar que pode desmentir.

## Um incidente que vale lembrar

Na primeira passagem da validação ao vivo, dois processos escreveram no mesmo formulário ao
mesmo tempo na subconta do cliente. O resultado foi uma cópia extra e uma exclusão que
ninguém pediu. Foi limpo, e a prova inteira do lado formulário foi refeita em série.

A causa raiz virou documentação: o perfil persistente do Chrome é único, então escrita ao
vivo é serial por construção. Dois comandos em paralelo travam no `SingletonLock`.
