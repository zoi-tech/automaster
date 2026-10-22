# Parte 2: manual do cliente

O manual explica ao cliente, em linguagem dele e com desenhos, o que as automações fazem
sozinhas e o que fica com a equipe. Roda depois das correções, sobre o estado publicado no dia.
Sai em `docs/<cliente>-manual-automacoes.html` e `docs/<cliente>-manual-automacoes.pdf`, na
pasta onde a skill roda. Só leitura no GHL, como na Parte 1.

## 1. Leitura

Extraia de novo (`/automaster-extract <locationId>`): as correções mudaram o desenho. Depois:

- **Publicados ao vivo:** `workflows_ao_vivo` (`o=lista`). Só entra no manual o que está
  `published` agora. Rascunho não existe para o cliente.
- **Desenho de cada publicado:** a ficha do auditor (comando `ficha`, como em `auditoria.md`)
  dá gatilho, filtros, esperas, ramos e o texto de cada mensagem. É dela que saem o fluxo, a
  linha do tempo e a grade da semana.
- **Texto aprovado de cada modelo de WhatsApp:** `whatsapp` (`o=templates`), com os componentes
  inteiros (cabeçalho, corpo, rodapé, botões). Só modelo `APPROVED` vira balão. Para um só, passe
  `template=<nome>`.
- **Se a `whatsapp` voltar vazia** com a linha ligada, o cliente tem a linha na integração da ZOI,
  e o GHL não enxerga os modelos. Peça a quem administra o Hub da ZOI o id da conta do WhatsApp
  (WABA) e o token da conexão do cliente, e puxe a lista direto da Meta:

  ```bash
  read -rs TOKEN_META   # cole o token recebido; ele fica só nesta sessão do terminal
  curl -s -H "Authorization: Bearer $TOKEN_META" \
    "https://graph.facebook.com/v23.0/<WABA_ID>/message_templates?fields=name,status,components&limit=100"
  ```

  O token não vai para arquivo, relatório, manual nem commit. Endereço, IP e credencial do Hub
  não entram em lugar nenhum desta skill.
- **Endereço do cabeçalho de localização:** não fica no modelo. Vem do passo do workflow que
  envia a mensagem (ficha ou tool `workflow` daquele passo).
- **Pessoas e lugares:** nomes dos usuários envolvidos (`inventario` com `fatia=users`), etapas do
  funil (`oportunidades`, `o=pipelines`), agendas e endereços (`agenda`, `o=calendarios`),
  horários de atendimento (as condições de horário nas fichas).
- **Canal:** confira a entrega pela `conversas` como manda o `SKILL.md`. Canal sem entregar vira
  o aviso da abertura.

## 2. Estrutura do manual

Adaptada ao que a subconta tem: seção sem conteúdo sai. Cada seção é uma ou mais `.folha`
(uma folha é uma página A4).

1. **Capa ZOI.** Montada pelo gerador a partir das opções do `manual-pdf`; não escreva a capa.
2. **Abertura:** "Sobre este manual" em duas frases, o aviso de pendência quando houver (canal
   aguardando a Meta, etapa ainda em ajuste) e o índice das seções.
3. **Caminho do cliente:** as fases, do primeiro contato até depois da venda ou da visita, e as
   regras que valem para tudo ("perdeu, parou", "uma mensagem por vez").
4. **Uma seção por área que existe:** entrada de lead, atendimento por canal (uma por linha de
   WhatsApp, se forem diferentes), funil e follow-up, agenda e visitas, cobrança.
5. **O que fica com a equipe:** os avisos que cada pessoa recebe (aviso, quem recebe, quando) e as
   tarefas manuais (o que o CRM não faz: marcar compareceu, mover card, responder).
6. **Organização das pastas:** as pastas como o cliente vê no app, em uma linha cada.
7. **Perguntas rápidas:** as dúvidas que a equipe mais tem, com resposta curta.

## 3. Peças do modelo

O `manual/modelo.html` desta skill traz cada peça com um comentário de uso e uma seção de exemplo
da cliente inventada Ribeira Seminovos. Use a peça pelo que ela explica:

- **Cabeçalho de seção** (`.cab`): no topo de toda folha.
- **Aviso** (`.aviso`): no máximo um, na abertura, para pendência passageira.
- **Índice** (`.indice`): na abertura.
- **Jornada** (`.jornada`) e **regras** (`.regras`): na folha do caminho do cliente.
- **Fluxo** (`.fluxo`): automação com decisão ou mais de um passo, de cima para baixo. `.no.gatilho`
  é o que dispara, `.no.pergunta` a decisão, `.no.acao` o que o CRM faz, `.no.perda` o cliente
  perdido; `.ramos` com `.rot sim` e `.rot nao` abrem os caminhos.
- **Linha do tempo** (`.tempo`): follow-up e lembretes, um marcador curto por passo (`1d`, `2h`),
  `.b.fim` quando a sequência acaba em perda.
- **Semana** (`.semana`): automação que depende do horário da loja, uma barra por dia em % das
  24 horas (1 hora = 4,1667%).
- **Funil** (`.funil`): as etapas em ordem, `.destaque` na etapa de que a folha fala.
- **Balão de WhatsApp** (`.zap`): quando o texto exato importa. `.titulo` diz quando sai, `.bolha`
  é a mensagem com `.rod` (rodapé do modelo), `.botoes` os botões (`.dois` para dois lado a lado) e
  `.mapa` o cartão de localização com o endereço do passo.
- **Duas colunas** (`.duas`): o balão de um lado, a tabela do que cada botão faz do outro.
- **Tabela:** lista com duas ou três informações por linha (botão e destino, aviso e quem recebe).
- **Quadro** (`.quadro`) e **quadro de alerta** (`.quadro.alerta`): uma regra curta; o alerta só
  onde há risco de engano (o que interrompe as automações, o que é à mão).
- **Pílula** (`.pilula`): nome curto, como pasta.
- **Perguntas** (`.faq`): pergunta em negrito e resposta curta, no fim.

## 4. Regras de linguagem

O cliente lê. O texto fala do que acontece com o cliente dele e com a equipe, não de como o CRM
foi montado.

- Sem id, tag (fale em "etiqueta" só se a equipe usa etiqueta no dia a dia), nome técnico de
  workflow, gatilho, webhook, nome de ferramenta (automaster, Hub, dump), número de execução,
  referência a relatório interno ou a contexto que o cliente não tem ("a correção de ontem").
- O nome da automação aparece como o cliente a reconhece: "o follow-up de 5 dias", "o lembrete da
  visita".
- Cada afirmação precisa ser verdade no estado publicado. O que não foi conferido nesta rodada
  sai do texto; não entra "deve", "provavelmente" nem promessa de algo ainda em rascunho.
- O balão reproduz o texto aprovado do modelo inteiro, com as quebras de linha e o rodapé, e troca
  as variáveis por nome e dados de exemplo ("Oi, Mariana!", "amanhã, às 15:00"). Sem `{{1}}` à
  mostra.
- Frases curtas, voz ativa, sem sigla sem explicação.

O gerador procura no texto visível, entre outros: id de 20 caracteres, workflow, tag, trigger,
gatilho, webhook, automaster, Hub, dump e marcas de modelo (`{{`, `}}`, `]]`). O que ele achar
volta em `termosInternos`.

## 5. Escrever o HTML

```bash
mkdir -p docs
cp "${CLAUDE_PLUGIN_ROOT}/skills/automaster-documentar/manual/modelo.html" docs/<cliente>-manual-automacoes.html
```

- Troque o `<title>` e as seções de exemplo pelas do cliente, na estrutura da seção 2. Mantenha o
  marcador `<!-- CSS DA ZOI -->` no `<head>` e o `{{CAPA}}` no começo do `<body>`: o gerador põe o
  estilo e a capa ali.
- Uma `.folha` por assunto, cada uma com `.cab` no topo e o `.rodape-tela` no fim (copie o de uma
  folha do modelo e acerte o número). Na impressão, logo e número de página vêm do próprio estilo.
- Apague os comentários de uso das peças quando a folha estiver pronta.

## 6. Gerar o PDF

O comando `manual-pdf` do extractor injeta o `zoi.css`, as fontes e a capa, gera o PDF numa
passada só no Chrome do sistema e confere seções e termos internos. Rode da pasta onde a skill
roda (a que tem `docs/`): o comando entra no extractor, então os arquivos vão com caminho absoluto.

```bash
DOCS="$PWD/docs"
cd "${CLAUDE_PLUGIN_ROOT}/extractor" && npx tsx src/cli.ts manual-pdf --html "$DOCS/<cliente>-manual-automacoes.html" \
  --saida "$DOCS/<cliente>-manual-automacoes.pdf" \
  --subtitulo "Automações da <Cliente>" --descricao "Como as automações do CRM atendem os seus clientes" \
  --preparado "<quem preparou>" --email "<e-mail de quem preparou>" --telefone "<telefone de quem preparou>" \
  --data AAAA-MM-DD
```

`--titulo` tem "Manual" como padrão. A resposta é um JSON com `pdf`, `paginas`,
`secoesEstouradas`, `termosInternos` e `avisos`:

- **`secoesEstouradas`:** cada item é uma folha mais alta que uma página A4, com o título. Divida
  a seção em duas folhas por assunto (cadência numa, perda na outra), nunca diminua letra nem
  corte conteúdo verdadeiro. Gere de novo.
- **`termosInternos`:** cada item traz o termo e o trecho em volta. Reescreva a frase na linguagem
  do cliente (seção 4) e gere de novo. Só entregue com a lista vazia.
- **`avisos`:** na primeira vez numa máquina, o gerador baixa as fontes da ZOI para
  `~/.automaster/fontes/`. Aviso de PDF sem as fontes da ZOI quer dizer que o download falhou:
  com internet de volta, gere de novo antes de entregar. Sem o Google Chrome instalado o comando
  para sem gerar nada; instale e rode de novo.

## 7. Conferência página a página

Com `secoesEstouradas` e `termosInternos` vazios, leia o PDF página a página como imagem antes de
entregar: o Read com `pages` de uma em uma, ou `pdftoppm -png -r 80` e o Read de cada PNG. Em cada
página:

- capa com título, subtítulo, quem preparou e data certos; a capa sem rodapé;
- rodapé com o logo da ZOI e o número, começando em 2;
- nada cortado no fim da página, nenhum balão ou fluxo partido ao meio, nenhuma folha quase vazia;
- balão com o texto aprovado inteiro, botões e rodapé do modelo;
- cada frase verdadeira no estado publicado lido nesta rodada;
- nenhum termo interno que o gerador não pegou (nome técnico de etapa, apelido de workflow).

Achou problema, corrija o HTML e volte à seção 6. A entrega diz o caminho do HTML e do PDF e o
número de páginas.
