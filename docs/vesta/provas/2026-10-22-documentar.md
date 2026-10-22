# Prova da skill automaster-documentar em duas subcontas

As duas rodadas foram só de leitura. Relatórios, manuais e PDFs ficaram na pasta de trabalho do
Luccas, fora do repositório; aqui fica só o registro, sem dado de cliente.

| Prova | Data | Páginas | Seções estouradas | Termos internos | Regras novas que acusaram | Conferido página a página |
|---|---|---|---|---|---|---|
| subconta A (concessionária, já reestruturada) | 2026-10-22 | 23 | 0 | 0 | duplicate_reply_responders: 1, exposed_secret: 2, opportunity_trigger_no_pipeline: 1 | sim |
| subconta B (concessionária) | 2026-10-22 | 8 | 0 | 0 | create_opportunity_without_lookup: 4, published_outside_folder: 1 | sim |

## Subconta A

O manual entregue antes (16 páginas, montado à mão) foi refeito pelo `manual-pdf` a partir do mesmo
conteúdo, convertido para as peças do `modelo.html`. Capa, peças e rodapé saíram iguais. A primeira
geração acusou 5 seções estouradas e "o PDF tem 21 páginas para 16 folhas"; dividir as seções
longas em folhas próprias zerou os avisos (23 páginas). As duas chaves acusadas já estavam
revogadas, mas o texto delas continua na subconta.

## Relatório da subconta B

- Canal entregando: as mensagens do atendente virtual e dos vendedores do dia saíram e foram lidas.
- O aviso interno de card parado rodou pelo menos 2.000 vezes em 13 dias para 500 contatos, com
  modelo de Marketing; entrou como urgente.
- 123 cards abertos sem dono, 88 com mais de 7 dias; 21 cards com a origem gravada como texto cru
  de variável.
- A procura de card não filtra o status em quatro caminhos: cliente que volta com card perdido não
  ganha card novo. Achado da leitura da ficha, sem regra automática.
- `create_opportunity_without_lookup` acusou 4 vezes, mas nenhum contato tem dois cards abertos:
  registrado como risco de desenho, não como urgente.
- O texto guardado no passo do lembrete de 2 horas é o de 3 dias, mas o modelo enviado é o certo:
  a prévia do passo pode estar velha, vale o modelo pelo id.
