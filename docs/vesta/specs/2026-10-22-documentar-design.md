# Skill `automaster-documentar`: auditoria e manual do cliente

## Contexto

Em 15/10/2026 a subconta de uma concessionária cliente (subconta A) passou por um processo completo: auditoria das
automações, reestruturação em quatro semanas e um manual para o cliente no padrão visual da
ZOI (16 páginas). O Luccas quer repetir o processo em qualquer
cliente sem refazer o caminho à mão.

## O que a skill faz

Duas partes, na ordem, cada uma podendo rodar sozinha:

1. **Auditoria.** Lê a subconta inteira e entrega um relatório interno em markdown com
   problemas, riscos e um plano de correção em ordem. Só propõe: não grava nada no GHL.
2. **Manual do cliente.** Lê o que está no ar e gera um PDF no padrão ZOI que explica, em
   linguagem de cliente e com desenhos, o que as automações fazem e o que fica com a equipe.
   Roda depois das correções, sobre o estado que estiver publicado.

A correção das automações fica fora da skill: o Luccas decide item a item a partir do
relatório.

## Onde mora

`skills/automaster-documentar/` no repositório do automaster, ao lado de
`automaster-dashboard`, `automaster-formulario-visual` e `automaster-leitura`. Vai versionada e
chega a quem tem o plugin.

```
skills/automaster-documentar/
  SKILL.md          quando usar, ordem das partes, regras comuns
  auditoria.md      método da auditoria e modelo do relatório
  manual.md         método do manual, estrutura, regras de linguagem e conferência
  manual/
    modelo.html     esqueleto do manual com as peças visuais e uma seção de exemplo de cada
    zoi.css         estilo ZOI (tokens do ZOI Design System, mesmo do MD Converter)
    assets/         logo e sol da ZOI em SVG (as fontes não vão no repositório; ver Fontes)
```

O gerador de PDF não fica na pasta da skill: é o comando `manual-pdf` do extractor
(TypeScript), que já tem o Playwright e abre o Chrome do sistema. A skill chama o comando pelo
caminho do plugin (`${CLAUDE_PLUGIN_ROOT}`), sem caminho absoluto.

## Regras comuns (SKILL.md)

- Só leitura no GHL nas duas partes. Nenhuma tool de escrita é chamada.
- Antes de ler, extrair a subconta de novo (`automaster-extract`). Dump antigo não descreve o
  que está no ar.
- O que muda a toda hora é lido ao vivo: quem está dentro de cada workflow
  (`workflows_ao_vivo`), status das últimas mensagens (`conversas`), funil (`oportunidades`,
  `pipeline`), agenda e texto dos modelos de WhatsApp.
- Antes de opinar sobre fluxo de mensagem, conferir se o canal entrega: a tool `conversas`
  passa a trazer o status de cada mensagem (entregue, lida, falhou) e o erro, e a skill lê as
  conversas dos últimos contatos que passaram pelos workflows de mensagem (achados em
  `workflows_ao_vivo`). Lição da subconta A: uma tarde de ajustes numa linha que não enviava.
- Número ou texto que vai para o relatório ou o manual tem que vir de uma leitura feita nesta
  rodada.

## Parte 1: auditoria (auditoria.md)

**Leitura.** Inventário, achados de severidade ERROR, cada workflow publicado (gatilhos,
filtros, passos, configurações como reentrada e parada por resposta), workflows em rascunho
com inscritos congelados, quem está dentro de cada workflow e há quanto tempo, funis e
estágios com volume, agendas, formulários com submissões, canais e status de entrega, modelos
de mensagem, usuários e rodízios.

**Lista de verificação**, com o que a subconta A ensinou:

- Card duplicado: mais de um caminho cria oportunidade sem procurar card aberto.
- Mensagem depois de perdido: perda não tira o contato da cadência, ou só tira de alguns
  workflows.
- Cadência que não para: "parar quando responder" não funciona com resposta que chega por
  provedor próprio de SMS; nada tira o contato quando o card muda de etapa ou é ganho.
- Duas respostas para a mesma mensagem: vários workflows com o mesmo gatilho de mensagem.
- Linha secundária que rouba lead: atribuição sem condição de dono.
- Gatilho de oportunidade sem filtro de pipeline.
- Condição impossível (horário que nunca casa, data "mesmo dia" sempre falsa).
- Espera que nunca chega (espera relativa ao compromisso já vencida pula o passo seguinte).
- Notificação para ninguém (avisa o "dono" depois de um passo que tirou o dono).
- Sobra de IA ou de integração desligada ainda publicada e rodando.
- Workflow fora de pasta (não aparece no app).
- Chaves expostas em custom value ou código.
- Fila de tarefa manual que só cresce.

Cada item achado entra com a evidência (workflow, passo, contagem) e o efeito para o cliente.

**Ficha por workflow.** Comando novo do auditor que lê a extração e escreve, para cada
workflow, uma ficha curta: status, pasta, configurações (reentrada, parar quando responder,
várias oportunidades), gatilhos com todos os filtros, e os passos na ordem com o texto das
mensagens, as esperas, as condições dos ramos e para onde cada ramo vai. A skill lê as fichas
para os itens que não têm regra e para entender o desenho.

**Regras novas do auditor** (aparecem também no `/automaster-audit`), uma por item da lista
que dá para ver na extração:

| Regra | Severidade |
|---|---|
| card criado sem procurar card aberto no mesmo funil | WARN |
| gatilho de oportunidade sem filtro de funil, em subconta com mais de um funil | WARN |
| condição de horário impossível no mesmo segmento | WARN |
| esperas relativas ao compromisso fora de ordem (a de depois é mais longa que a de antes) | WARN |
| aviso ao dono num caminho que tirou o dono antes, sem atribuir de novo | WARN |
| dois workflows publicados com o mesmo gatilho de resposta mandando mensagem | WARN |
| workflow publicado fora de pasta | WARN |
| chave de integração exposta em custom value ou código | ERROR |
| perda que não tira o contato da cadência (por aproximação) | INFO |
| cadência sem saída quando o card muda de etapa ou é ganho (por aproximação) | INFO |
| sobra de IA ou integração desligada ainda publicada (por aproximação) | INFO |

As três por aproximação podem acusar falso positivo e entram no relatório como pergunta.
Mensagem depois de perdido, fila de tarefa manual e inscritos congelados em rascunho dependem
de leitura ao vivo e ficam com a skill.

**Relatório** em `docs/<cliente>-auditoria-AAAA-MM-DD.md`, com as seções: resumo; urgente;
diagnóstico por área (entrada, atendimento, funil, agenda, integrações, lixo); proposta de
estrutura (pastas e nomes no padrão `[Área] Gatilho → Ação`); ordem sugerida em etapas;
números de referência dos últimos 30 dias. Itens "sem uso" entram como pergunta, nunca como
pedido de conserto.

## Parte 2: manual do cliente (manual.md)

**Leitura.** Workflows publicados ao vivo, texto aprovado de cada modelo de WhatsApp usado,
nomes dos usuários envolvidos, etapas do funil, agendas e endereços, horários de atendimento.

O texto dos modelos vem da tool `whatsapp` (`o=templates`). Em cliente cuja linha está na
integração da ZOI, o GHL não enxerga os modelos e a tool volta vazia: a skill orienta puxar a
lista direto da Meta (`GET /<WABA_ID>/message_templates?fields=name,status,components`) com o
token da conexão no Hub da ZOI, pedido a quem administra o Hub. Endereço, IP ou credencial do
Hub não entram na skill (o repositório é público). O endereço do cabeçalho de localização não
fica no modelo: vem do passo do workflow que envia.

**Estrutura** (adaptada ao que a subconta tem; seção sem conteúdo sai): capa ZOI; abertura
com aviso de pendência quando houver e o índice; caminho do cliente; uma seção por área que
existe (entrada de lead, atendimento por canal, funil e follow-up, agenda e visitas,
cobrança); o que fica com a equipe (avisos que recebem e tarefas manuais); organização das
pastas; perguntas rápidas.

**Peças visuais** do modelo: fluxo vertical com perguntas e ramos, linha do tempo, grade da
semana com horários, faixa de etapas do funil, cartões, tabela, quadro de destaque e balão de
WhatsApp com botões, mapa e rodapé. Os balões reproduzem o texto aprovado do modelo, com nome
e dados de exemplo.

**Linguagem.** Cliente lê. Sem id, tag, nome técnico de workflow, nome de ferramenta, número de
execução, referência a relatório interno ou contexto que o cliente não tem. Cada afirmação
precisa ser verdade no estado publicado; o que não foi conferido sai do texto.

**Saída** em `docs/<cliente>-manual-automacoes.html` e `.pdf`.

## Gerador (`manual-pdf` do extractor)

Entrada: o HTML do manual e os dados da capa (título, subtítulo, descrição, preparado por,
e-mail, telefone, data). Faz, numa passada só:

1. Monta a capa ZOI (porte do HTML e CSS da capa do MD Converter) e injeta o `zoi.css` e as
   fontes (ver Fontes).
2. Carrega o HTML no Chrome do sistema e espera as fontes carregarem.
3. Mede cada seção com a largura útil da página A4 e lista a que passa de uma página, com o
   título.
4. Procura termos internos no texto visível (lista no próprio comando) e lista cada
   ocorrência.
5. Gera o PDF com rodapé pelo próprio CSS da página: logo da ZOI à esquerda e número à
   direita, capa sem rodapé, numeração começando em 2 como no MD Converter. Sem junção de
   arquivos.
6. Imprime o caminho do PDF, o número de páginas e o resultado das conferências 3 e 4.

Seção que estoura ou termo interno achado não impede o PDF, mas sai no resumo como aviso para
corrigir antes de entregar. Depois do gerador, quem roda a skill lê cada página do PDF como
imagem.

## Fontes

O repositório é público e a licença das fontes da ZOI (ITF FFL) proíbe distribuí-las por
repositório. Na primeira vez que o gerador roda numa máquina, ele baixa Clash Display e
Satoshi da Fontshare e guarda em `~/.automaster/fontes/`; das próximas vezes usa o que está lá.
Sem internet ou com o download falhando, usa a fonte do sistema e avisa no resumo que o PDF saiu
sem a tipografia da marca.

## Erros

- Extração falha ou pede login: parar e pedir o login, como as outras skills do automaster.
- Canal sem entregar: registrar no relatório como urgente e, no manual, um aviso curto no
  começo, sem detalhe técnico.
- Leitura ao vivo estrangulada pelo servidor: repetir depois; não concluir "ninguém dentro".
- Chrome do sistema ausente: o gerador diz isso e para, sem gerar PDF pela metade.

## Provas

O repositório é público: nada de cliente real entra nele. O `modelo.html` usa um cliente
inventado, e as provas com clientes reais rodam na pasta do Luccas, fora do repositório.

1. O gerador refaz o manual da subconta A (conteúdo na pasta de trabalho do Luccas, fora do repositório) e chega ao mesmo resultado
   visual (capa, peças, rodapé), sem seção estourada e sem termo interno.
2. A skill inteira roda numa segunda subconta (subconta B, outra concessionária), só lendo, e entrega relatório e
   manual de verdade, conferidos página a página.
3. Testes automáticos no padrão do repositório, sem abrir navegador (o CI não tem): montagem da
   capa, busca de termos internos, conta de seção estourada a partir das medidas, ficha por
   workflow, cada regra nova com fixture e o status na `conversas`. A geração real do PDF é
   prova manual da etapa.

## Fora do escopo

- Corrigir automações no GHL.
- Relatório interno em PDF.
- Enviar o manual ao cliente.

## Decisões do grill

- **A1** — fontes da ZOI fora do repositório; o gerador baixa da Fontshare na primeira vez e
  guarda em `~/.automaster/fontes/`, com a fonte do sistema como reserva. Motivo: o repositório
  é público e a licença ITF FFL proíbe distribuir as fontes por repositório.
- **A2** — modelo com cliente inventado; provas com clientes reais fora do repositório.
  Motivo: commit `f2b654c` tornou o repositório público, sem dados de cliente.
- **A3** — gerador vira o comando `manual-pdf` do extractor, em TypeScript. Motivo: o extractor
  já tem Playwright e usa o Chrome do sistema; o lado Python não tem nenhum dos dois.
- **A4** — PDF numa passada só, rodapé pelo CSS da página. Motivo: testado no Chrome 155; tira a
  junção de arquivos e a renumeração errada do `pageRanges`.
- **A5** — mantido; a medição usa a largura útil da página A4 e espera as fontes. Motivo:
  medir com o viewport padrão errou 1,5 contra 3 páginas no teste.
- **A6** — status e erro de cada mensagem entram na tool `conversas`. Motivo: nenhuma tool mostra
  entrega, e a subconta A perdeu uma tarde numa linha que não enviava.
- **A7** — ficha por workflow e 11 regras novas no auditor (8 certas, 3 por aproximação como
  INFO). Motivo: as tools não expõem configurações nem filtros, e o Luccas quer os itens
  acusados também no `/automaster-audit`.
- **A8** — mantido, com reserva: modelos pela tool `whatsapp`; vazio, pela Meta com o token da
  conexão no Hub, sem dado do Hub no repositório.
- **A9** — teste automático só das partes sem navegador; geração real do PDF é prova manual.
  Motivo: o CI não abre Chrome (`.github/workflows/ci.yml:20-23`).
- **A10** — logo e sol em SVG. Motivo: `*.png` está no `.gitignore`.
- **A11** — próxima versão livre no momento do merge, com CHANGELOG. Motivo: a 0.32.0 está
  reservada para a autoevolução.
- **A12, A13, A14** — confirmam a spec; entram no plano (teste da skill, citação no
  `CLAUDE.md`, caminho pelo `CLAUDE_PLUGIN_ROOT`, corrigir a frase velha sobre a pasta de dumps
  na `automaster-leitura`).
- Segunda subconta de prova: subconta B (concessionária), escolhida pelo Luccas.
