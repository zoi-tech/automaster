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
