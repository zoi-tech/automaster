# Sessão de fundo

Este arquivo reúne o contrato do processo de fundo e as provas ao vivo que o sustentam.

## Prova A19 — cliente sobre fetch

Subconta de teste Instaltech (`Xb9gDxwxYhdqtprGcb5E`). O contato de teste antigo
(`uWqujqll20tRuglV3mLt`) não existe mais: o GHL devolve `400 Contact not found`, e com ele
os dois clientes falhavam nas mesmas 3 checagens do smoke (`contato/detalhe`,
`conversas/busca`, `anotacoes/notas`), 20 ok. As escritas e os smokes abaixo usaram o
contato `ZlkU3kiMDr0xiIGLiMC5` (ZZ TESTE AUTOMASTER, criado por uma submissão de teste de
formulário). Ele não tinha conversa, e o upload exige uma: a conversa
`iaz7QbRDLz2al30jCjAA` foi criada por uma nota interna (`InternalComment`, não chega ao
contato), recebeu o anexo e foi apagada em seguida.

- Data: 2026-10-09
- Tempo de `tags` antes (Chrome visível, cliente antigo): 4,60 s
- Smoke com o cliente antigo: 23 ok, 0 falhou, 0 pulado
- Smoke com fetch: 23 ok, 0 falhou, 0 pulado
- Checagens que falharam só com fetch: nenhuma
- Extração completa com fetch (download sem auth do Firebase): 80 workflows, 0 falhas
- Escrita JSON (criar tag e criar nota): ok
- DELETE com corpo (remover tag do contato e repor): ok
- DELETE sem corpo (apagar tag e apagar nota): ok
- Multipart (anexo): ok
- Cabeçalhos além dos de hoje: nenhum
- Resíduo: anexo https://app.aceleradorazoi.com.br/conversations-assets/location/Xb9gDxwxYhdqtprGcb5E/conversations/iaz7QbRDLz2al30jCjAA/284c0f0d-c79b-48cf-9832-06e18e6a719e.png no armazenamento do CRM; a tag `teste-a19-fetch` e a nota foram apagadas, a conversa criada para o anexo foi apagada e a tag `teste-automaster` do contato voltou ao estado de antes

## Prova ao vivo do Chrome de fundo

Prova pelo comando `sessao`, na Instaltech (`Xb9gDxwxYhdqtprGcb5E`), com o Chrome do sistema,
um comando de cada vez. Nenhuma escrita na API do GHL.

- Data: 2026-10-09
- Captura invisível no perfil real (sessao --acao tokens, partida fria): 4,20 s
- Chrome do perfil com --headless: sim
- Chrome invisível registrado como app no macOS (System Events): 0
- Pedidos do Chrome invisível sem Headless (user-agent e sec-ch-ua): ok
- Perfil aberto por outro Chrome vira erro com pid: ok
- Login com janela e volta ao invisível: ok
- SIGTERM fecha limpo (exit_type Normal, trava e socket removidos): ok
- Chrome morto com o processo de fundo vivo: o pedido seguinte reabre: ok
- kill -9 no processo de fundo: o pedido seguinte sai ok: ok

No passo 9 o Chrome não sobreviveu ao kill -9: 10 s depois não havia Chrome no perfil (só a
trava e o socket velhos), e o `renovar` seguinte subiu um processo de fundo novo e deu `ok` em
6,2 s, com um único Chrome principal no perfil.

Notas da prova:
- O System Events conta o Chrome invisível como processo (`BackgroundOnly`); o instrumento só
  separa janela de invisível com `background only is false` (janela de login: 1; invisível: 0).
- O SIGTERM deixava o perfil com `exit_type` `Crashed` por dois defeitos, ambos corrigidos: os
  tratadores de sinal do Playwright (`handleSIGTERM`/`SIGINT`/`SIGHUP`) matavam o Chrome em
  paralelo ao fechamento, deixando também o `SingletonLock` órfão; e fechar o contexto direto
  perpetuava `Crashed` num perfil que já tinha saído assim — fechar as páginas antes do contexto
  sai `Normal`. Este segundo defeito também existe no caminho antigo de hoje. Depois das
  correções: SIGTERM limpo em 0,3 s (Chrome fechado em 91 ms), `exit_type` `Normal`, sem
  `SingletonLock`.
- O `encerrar` passou de 20 s duas vezes logo após uma captura (Chrome fechado em 24,3 s na
  segunda); o processo saiu sozinho e limpo, mas o comando respondeu `sessao_indisponivel`.
- No passo 9 o `wc -l` do plano deu 7 porque `MacOS/Google Chrome ` também casa com os helpers;
  processo principal do Chrome no perfil, só um.
