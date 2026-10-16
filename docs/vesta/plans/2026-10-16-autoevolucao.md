# Plano — autoevolução do plugin automaster

Objetivo: o plugin percebe os próprios problemas, aprende na hora naquela máquina e abre
issue limpa e única no `zoi-tech/automaster`.

Spec: `docs/vesta/specs/2026-10-16-autoevolucao-design.md` (leia as seções citadas em cada
etapa; as decisões do grill estão no fim dela).

Comando de teste (da raiz):

```bash
cd auditor && .venv/bin/python -m pytest -q && cd ../extractor && npm test
```

Lint, que também precisa passar ao fim de cada etapa (o CI roda):
`cd auditor && .venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests`
e, quando a etapa mexer no extractor, `cd extractor && npm run typecheck && npm run lint`.

Pastas de tela: nenhuma. Mockup: nenhum: sem tela.

Convenções do repo que valem em todas as etapas: Python ≥ 3.12, sem dependência nova
(`auditor/pyproject.toml` não tem dependência de runtime e assim fica); stdlib só. Comentário
e docstring em português, no tom dos módulos vizinhos. Nada de `print` no servidor MCP (o
stdout é o protocolo).

---

## Etapa 1 — `ToolError` com código obrigatório

Tela: não.

Arquivos:
- mudar `auditor/src/automaster_audit/mcp/base.py`
- mudar todos os módulos com `raise ToolError` em `auditor/src/automaster_audit/mcp/`:
  `agenda.py` (23), `contato.py` (12), `base.py` (8), `conversas.py` (26), `tags.py` (5),
  `dump.py` (6), `emails.py` (2), `paineis.py` (8), `formularios.py` (16),
  `oportunidades.py` (13), `workflows.py` (12)
- criar `auditor/tests/test_toolerror_codigo.py`

O que prova a etapa:
- todo `raise ToolError(...)` em `auditor/src/automaster_audit/mcp/*.py` passa `codigo=` como
  argumento nomeado, com um valor da lista; o teste lê os arquivos com `ast` (não por regex) e
  aponta arquivo:linha de cada um que faltar. `raise` sem argumento (re-raise) não conta.
- `ToolError("x")` sem código ainda é aceito em tempo de execução e vale `codigo == "falha"`
  (código de fora de `mcp/` que ainda levante sem código não quebra).
- `_run_extractor` com envelope `{ok:false, error:{code:"login_pendente"}}` levanta com
  `codigo == "extractor:login_pendente"`; com `http_404`, `"extractor:http_404"`; com
  returncode ≠ 0 e sem envelope, `"extractor:erro"`; timeout, `"extractor:timeout"`;
  `tsx` ausente, `"ambiente"`; sem argumentos, `"falha"`. Use o `espiao`/monkeypatch de
  `subprocess.run` como em `auditor/tests/test_mcp_tools.py:15-31`.
- `dashboard_ver` com `login_pendente` (`mcp/paineis.py:92-103`) relança mantendo o código
  `extractor:login_pendente`.
- `str(e)` de todo erro continua idêntico ao de hoje (as mensagens não mudam; testes antigos
  que conferem texto seguem verdes).

Como fazer:
- Em `base.py:35-36`:
  ```python
  CODIGOS = frozenset({"guarda", "argumento", "nao_encontrado", "ambiente", "falha"})

  class ToolError(Exception):
      """..."""
      def __init__(self, msg: str, *, codigo: str = "falha"):
          super().__init__(msg)
          self.codigo = codigo
  ```
  `extractor:<x>` também é válido (prefixo), além de `CODIGOS`.
- Critério para cada `raise` (spec, seção "O relato"):
  - `guarda`: a tool recusou de propósito — "repita com confirmo=true", `apagar_citada`
    (`mcp/tags.py:108-115`), "confirmo=true exige versao_esperada" (`mcp/paineis.py:72`),
    qualquer recusa de segurança.
  - `argumento`: valor inválido/faltando/combinação proibida no que o agente mandou ("o
    inválido", "exige X", "use A ou B").
  - `nao_encontrado`: subconta sem dump (`base.py:57`), snapshot inexistente
    (`base.py:63`, `:65`), workflow/form/item não achado.
  - `ambiente`: extractor não provisionado (`base.py:140`).
  - `falha`: "uso interno" (`base.py:137`), `DumpError` virando `ToolError` (`base.py:80`,
    dump recusado é defeito de contrato entre as partes), e todo estado que "não deveria
    acontecer".
- `_run_extractor` (`base.py:165`, `:175`): `codigo=f"extractor:{erro.get('code') or 'erro'}"`
  e `codigo="extractor:timeout"` no `TimeoutExpired`.
- `paineis.py:97-103`: `raise ToolError(..., codigo=e.codigo) from e`.
- Rode a suíte inteira no fim: nenhum teste antigo pode mudar.

---

## Etapa 2 — Módulo `aprendizado`: pasta, filtro, assinatura, fila e lições

Tela: não.

Arquivos:
- criar `auditor/src/automaster_audit/aprendizado.py`
- mudar `auditor/tests/conftest.py` (fixture `autouse`)
- criar `auditor/tests/test_aprendizado.py`

O que prova a etapa:
- `pasta()` é `AUTOMASTER_APRENDIZADOS` quando definida, senão `~/.automaster/aprendizados`,
  e é criada na primeira gravação com permissão 0700.
- `limpar(texto)`:
  - troca e-mail por `<email>`; telefone BR (com ou sem +55, DDD, 8 ou 9 dígitos, com
    espaço, hífen ou parênteses) por `<telefone>`; URL `http(s)://…` por `<url>`;
    qualquer palavra de 20 alfanuméricos por `<id>`; ObjectId de 24 hex por `<id>`;
    UUID por `<id>`; JWT/Bearer (`eyJ…` e `Bearer …`) por `<token>`.
  - não toca em `abc123def456` (12 hex, formato da assinatura), em versão `0.32.0`, em
    código `http_404`, em nome de tool `workflow_editar`, em `arquivo.py:123`.
  - `idTeste0000000000004` também vira `<id>` (mascarar a mais é o erro barato, spec A12).
- `assinatura(relato)`: 12 hex de `sha256`; `erro_tool` usa `tipo + tool + codigo`; os
  outros tipos usam `tipo + tool + resumo normalizado` (minúsculas, sem acento, sem
  pontuação, espaços colapsados). Mesmo erro, mesma assinatura; tool diferente, diferente;
  resumo que difere só em acento/maiúscula, igual.
- `normalizar_relato(dict)`: aceita os campos da spec (`tipo`, `tool`, `codigo`, `resumo`,
  `detalhe`, `sugestao`, `licao`, `duplicata_de`, `nova`); recusa `tipo` fora dos quatro com
  `ValueError`; passa `limpar` em todo texto; corta `resumo` em 120 caracteres, `licao` em
  200 e `detalhe`/`sugestao` em 1.500; relato com `resumo` vazio depois do filtro devolve
  `None` (descartado).
- `enfileirar(relato)`: acrescenta uma linha JSON em `fila.jsonl` com `assinatura`,
  `versao` (do plugin) e `em` (ISO UTC); a mesma assinatura já na fila não duplica, só soma
  `ocorrencias`.
- `licoes_ativas(limite=15)`: lê `licoes.json`, devolve as ativas, mais recentes primeiro,
  no máximo 15.
- `adicionar_licao(texto, issue, versao)`: grava; a mesma `issue` não duplica (atualiza o
  texto).
- `texto_licoes()`: o bloco que o `SessionStart` imprime — título curto ("Lições do
  automaster nesta máquina") e uma linha por lição com `(#N)`; vazio quando não há lição.
  Nunca passa de 4.000 caracteres.
- `versao_maior(a, b)`: compara `0.32.0` > `0.31.10` > `0.31.9` numericamente; `"0"` é menor
  que tudo.
- fixture `autouse` do `conftest.py`: em todo teste, `AUTOMASTER_APRENDIZADOS` aponta para
  `tmp_path/"aprendizados"` e `AUTOMASTER_PUBLICAR=0` (publicação real desligada).

Como fazer:
- Arquivos na pasta (spec, "Arquitetura"): `licoes.json`, `fila.jsonl`, `publicadas.json`,
  `revisadas.json`. Grave JSON de forma atômica: escreva em `arquivo.tmp` no mesmo
  diretório e `os.replace` (não existe helper Python disso no repo; o padrão em TS é
  `extractor/src/fundo/chrome.ts:157-171`).
- Versão do plugin: reuse `mcp_server._version()` (`mcp_server.py:98-106`) movendo a função
  para `aprendizado.py` e fazendo `mcp_server` importá-la de lá (evita import circular:
  `aprendizado` não importa `mcp_server`).
- Regex de telefone: exija DDD (2 dígitos, primeiro de 1 a 9) e 8 ou 9 dígitos, para não
  casar qualquer sequência numérica; a ordem é URL, e-mail, token, ids, telefone.
- Sem rede nesta etapa.

---

## Etapa 3 — Publicação no GitHub, deduplicação e aposentadoria

Tela: não.

Arquivos:
- mudar `auditor/src/automaster_audit/aprendizado.py`
- criar `auditor/tests/test_aprendizado_publicar.py`

O que prova a etapa (todos com `gh` falso: um executável `gh` em `tmp_path/bin` posto no
começo do `PATH`, que grava os argumentos e o stdin num arquivo e responde o JSON que o teste
mandar; com `AUTOMASTER_PUBLICAR=1` só dentro destes testes):
- `publicar_fila()` sem `gh` no `PATH`: não levanta, devolve `{"publicadas": 0,
  "pendentes": N}` e a fila fica intacta.
- `gh auth status` falhando: idem.
- relato novo: roda `gh label create auto-relato --force …` e `gh label create <tipo>
  --force …`, depois `gh issue create --repo zoi-tech/automaster --title "[auto] <tipo>:
  <resumo>" --label auto-relato --label <tipo> --body-file -`; o corpo tem tool, código,
  versão, o que aconteceu, sugestão, lição proposta, a linha `Ocorrências: 1 · última:
  AAAA-MM-DD · versões: 0.32.0` e `<!-- automaster-assinatura: <12hex> -->`; a assinatura e o
  número vão para `publicadas.json`; o relato sai da fila.
- o corpo enviado ao `gh` passa por `limpar` de novo (um relato montado à mão com e-mail no
  `detalhe` sai com `<email>`).
- mesma assinatura já publicada e aberta: não cria; roda `gh issue edit <n> --body-file -`
  com `Ocorrências: 2`, a data de hoje e a versão acrescentada à lista se nova.
- assinatura nova, mas uma issue aberta com `auto-relato` contém a assinatura no corpo
  (publicada por outra máquina): trata como repetição dessa issue.
- `duplicata_de=12`: edita a #12, não cria.
- trava diária: com 5 issues criadas hoje (contador em `publicadas.json`), a sexta fica na
  fila; repetição (edição) não conta para a trava.
- `parecidas(relato, abertas)`: devolve as issues abertas cujo título, depois de
  normalizado, tem razão de semelhança ≥ 0,6 com o resumo (`difflib.SequenceMatcher`), no
  máximo 3; `erro_tool` não usa parecença, só assinatura.
- concorrência: duas chamadas de `publicar_fila()` em processos diferentes ao mesmo tempo
  (via `multiprocessing`) criam uma issue só para o mesmo relato.
- `gh` respondendo erro no `issue create`: o relato fica na fila; a próxima chamada tenta de
  novo.
- `aposentar_licoes()`: com `gh issue view <n> --json state,stateReason` respondendo
  `CLOSED`/`COMPLETED` e versão instalada maior que a da lição, a lição sai das ativas;
  `NOT_PLANNED` mantém; `COMPLETED` com versão igual mantém; `gh` ausente não muda nada.
- `relatar(relato)` (função do módulo, usada pela tool na etapa 5): normaliza; se houver
  parecidas e o relato não trouxer `duplicata_de` nem `nova`, devolve
  `{"publicado": False, "parecidas": [{numero, titulo}]}` sem enfileirar; senão enfileira,
  grava a lição (se houver `licao`) ligada à issue quando o número já existe, chama
  `publicar_fila()` e devolve `{"publicado": bool, "issue": n|None, "pendente": bool}`.
  Lição de relato que ficou pendente é gravada sem número e ganha o número quando a issue
  sair.

Como fazer:
- Todo `gh` por `subprocess.run([...], capture_output=True, text=True, timeout=30,
  check=False)`; nunca `shell=True`. Repo fixo `zoi-tech/automaster` numa constante
  `REPO`, sobrescrevível por `AUTOMASTER_REPO`.
- Abertas: `gh issue list --repo REPO --label auto-relato --state open --limit 100 --json
  number,title,body`.
- Trava de processo: `fcntl.flock(fd, LOCK_EX)` em `pasta()/publicar.lock` cobrindo ler
  fila → consultar abertas → criar/editar → regravar fila e `publicadas.json` (spec A14).
- Entre duas chamadas de escrita ao GitHub, `time.sleep(1)` (boa prática do GitHub para
  criação de conteúdo); nos testes, monkeypatch do `sleep`.
- `AUTOMASTER_PUBLICAR=0` faz `publicar_fila()` devolver sem rodar `gh` (é o que o
  `conftest` liga em todo teste).

---

## Etapa 4 — Erro automático e servidor que não cai

Tela: não.

Arquivos:
- mudar `auditor/src/automaster_audit/mcp_server.py`
- mudar `auditor/src/automaster_audit/aprendizado.py` (função `registrar_erro`)
- criar `auditor/tests/test_mcp_erro_automatico.py`

O que prova a etapa (pelo `srv.handle` com `tools/call`, como em
`auditor/tests/test_mcp_tools.py:247-279`):
- tool que levanta `ToolError(codigo="falha")`: resposta `isError: True` com o texto de
  sempre, e `fila.jsonl` ganha um relato `erro_tool` com `tool`, `codigo` e o texto filtrado.
- `codigo="extractor:http_404"` e `"extractor:erro"`: relatam.
- `guarda`, `argumento`, `nao_encontrado`, `ambiente`, `extractor:login_pendente`,
  `extractor:sessao_indisponivel`, `extractor:timeout`: não relatam; a resposta é igual.
- `TypeError` (argumento desconhecido): resposta como hoje e relato `dificuldade` com a tool
  e o nome do argumento, sem os valores.
- tool que levanta `KeyError('segredo@x.com')`: a resposta é `isError: True` com texto
  "erro interno do automaster em <tool> (KeyError); relatado." e **o servidor responde à
  chamada seguinte** (um `tools/list` depois funciona); o relato é `erro_tool`,
  `codigo="falha"`, com o tipo da exceção e o `arquivo:linha` do último quadro dentro de
  `automaster_audit`, e sem a mensagem da exceção (o texto `segredo@x.com` não aparece em
  nenhum arquivo da pasta de aprendizados).
- `registrar_erro` levantando (pasta sem permissão, disco cheio simulado): a resposta da
  tool é a mesma de sem registro.
- `registrar_erro` não chama `gh` (só enfileira; a publicação é da tool `relatar` e da
  revisão).

Como fazer:
- `mcp_server.py:123-127` vira:
  ```python
  try:
      body = TOOLS[name][0](**(params.get("arguments") or {}))
      result = {...}
  except (ToolError, TypeError) as e:
      result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
      _registrar(name, e)
  except Exception as e:  # noqa: BLE001 - tool quebrada não derruba o servidor (spec A5)
      result = {"content": [{"type": "text", "text": f"erro interno do automaster em {name} ({type(e).__name__}); relatado."}], "isError": True}
      _registrar(name, e)
  ```
  `_registrar` chama `aprendizado.registrar_erro` dentro de `try/except Exception: pass`.
- O quadro: `traceback.extract_tb(e.__traceback__)`, o último com `"automaster_audit"` no
  `filename`; grave caminho relativo a `automaster_audit/` e a linha.
- Não toque no `main()` além do necessário.

---

## Etapa 5 — Tool `relatar` e a instrução na skill

Tela: não.

Arquivos:
- criar `auditor/src/automaster_audit/mcp/aprendizado.py`
- mudar `auditor/src/automaster_audit/mcp_server.py` (juntar a fatia e re-exportar)
- mudar `skills/automaster-leitura/SKILL.md`
- mudar `.claude-plugin/plugin.json` (descrição: 37 tools)
- mudar `auditor/tests/test_mcp_paineis.py:71-75` (36 → 37)
- criar `auditor/tests/test_mcp_relatar.py`

O que prova a etapa:
- `srv.TOOLS["relatar"]` existe, com `required == ["tipo", "resumo"]`, e `len(srv.TOOLS) ==
  37`; `plugin.json` diz "37 tools".
- `relatar(tipo="correcao", resumo="…", detalhe="…", licao="…")` chama
  `aprendizado.relatar` e devolve o que ela devolve; `tipo` inválido levanta `ToolError` com
  `codigo="argumento"`.
- com parecidas, a resposta traz `parecidas` e a instrução "chame de novo com
  duplicata_de=<n> ou nova=true".
- a descrição da tool diz, em português curto: quando chamar (o usuário corrigiu algo que o
  automaster fez; você tentou de novo, contornou ou a skill não cobria; pediram algo que
  nenhuma tool faz); que o texto vai para issue PÚBLICA e deve ser genérico, sem nome,
  telefone, e-mail, id de subconta/contato/workflow nem trecho de conversa; que `licao` é
  uma linha imperativa que vale já nas próximas sessões desta máquina.
- a descrição passa no teste `PROIBIDO` de `auditor/tests/test_sessao_de_fundo_docs.py:56-60`.
- as 6 primeiras linhas de `skills/automaster-leitura/SKILL.md` citam `relatar`
  (o teste `test_mcp_paineis.py:78-83` lê o cabeçalho; acrescente `relatar` à lista do
  frontmatter).
- a skill ganha a seção `## Quando relatar (\`relatar\`)` dizendo: chamar sem pedir
  permissão, uma vez por problema, nos quatro casos; não relatar erro que a tool já
  devolveu sozinha com falha do GHL (o servidor já registrou); não relatar guarda
  funcionando como pedido; escrever genérico. Um teste confere que a seção existe e cita
  os quatro casos.

Como fazer:
- Padrão de fatia: `mcp/tags.py:126-167` (`TOOLS = {"nome": (fn, descrição, props,
  required)}`). Junção: `mcp_server.py:59-70`; re-exportação: `:73-88`.
- `props`: `tipo` (enum dos quatro), `resumo`, `tool`, `detalhe`, `sugestao`, `licao`
  (strings), `duplicata_de` (integer), `nova` (boolean).
- A contagem 36 também aparece em `CLAUDE.md`; ela muda na etapa 8, junto com o
  `test_release`. Se algum teste exigir 36 no `CLAUDE.md` nesta etapa
  (`auditor/tests/test_release_0_31_0.py:53-57`), atualize `CLAUDE.md` aqui mesmo para
  "trinta e sete" e ajuste esse teste para 37.

---

## Etapa 6 — Revisão das conversas em segundo plano e os hooks

Tela: não.

Arquivos:
- criar `auditor/src/automaster_audit/revisao.py` (com `main()` e `if __name__ ==
  "__main__"`)
- mudar `hooks/scripts/check-setup.sh`
- mudar `hooks/hooks.json`
- criar `auditor/tests/test_revisao.py`
- criar `auditor/tests/test_hook_inicio.py`

O que prova a etapa:
- `conversas_pendentes(raiz, agora)` (raiz = `~/.claude/projects` por padrão,
  `AUTOMASTER_CLAUDE_PROJECTS` nos testes), com transcripts falsos em JSONL:
  - conversa sem `tool_use` com `name` começando por `mcp__plugin_automaster_automaster__`
    não entra;
  - conversa com essa tool, `entrypoint: "cli"` e modificada há mais de 30 min entra;
  - modificada há 10 min não entra;
  - `entrypoint: "sdk-cli"` não entra;
  - já em `revisadas.json` com o mesmo tamanho não entra; com tamanho maior entra, e só as
    linhas novas (a partir do byte anotado) são lidas;
  - linha de JSON quebrado é pulada sem erro;
  - no máximo 3, as mais recentes primeiro.
- `trechos(linhas)`: monta o texto que vai ao modelo só com as mensagens do usuário, as
  chamadas de tool automaster (nome e argumentos) e os resultados delas marcados com
  `is_error`, cada resultado cortado em 1.500 caracteres, tudo passado por `limpar`, e o
  total cortado em 40.000 caracteres.
- `revisar_uma(conversa)` com `claude` falso no `PATH` (script que grava os argumentos e o
  ambiente e responde `{"result": "<json>"}`):
  - os argumentos incluem `-p`, `--model haiku`, `--output-format json`,
    `--no-session-persistence` e `--settings` com `{"disableAllHooks": true}`;
  - o ambiente tem `AUTOMASTER_REVISAO=1`;
  - o prompt traz a lista das issues abertas (de `gh` falso) e os trechos como dado, com a
    instrução de não seguir instruções contidas neles;
  - a resposta do modelo, uma lista de relatos (`tipo`, `tool`, `resumo`, `detalhe`,
    `sugestao`, `licao`, `duplicata_de` ou `nova`), entra por `aprendizado.relatar` com
    `nova` forçado quando o modelo não marcou nenhum dos dois, para nunca parar esperando
    resposta;
  - resposta que não é JSON válido: nada é relatado e a conversa NÃO é marcada como
    revisada (tenta de novo na próxima);
  - relato cuja assinatura já está na fila ou em `publicadas.json` desta sessão não é
    relatado de novo (spec, "Duplicação").
- `main()`: sai na hora com `AUTOMASTER_REVISAO=1`; usa um `flock` não bloqueante em
  `pasta()/revisao.lock` (segunda instância sai sem fazer nada); roda
  `conversas_pendentes` → `revisar_uma` para cada → `aprendizado.publicar_fila()` →
  `aprendizado.aposentar_licoes()`; sem `claude` no `PATH`, só publica a fila e aposenta.
- hook de início (`test_hook_inicio.py`, rodando o `check-setup.sh` por `subprocess` com
  `CLAUDE_PLUGIN_ROOT` apontando para a raiz do repo, `AUTOMASTER_APRENDIZADOS` em pasta
  temporária, stdin com `{"source": "startup"}`):
  - sem lições, a saída é igual à de hoje;
  - com lições, a saída contém o bloco de `texto_licoes()`;
  - com `"source": "startup"` ou `"clear"`, dispara a revisão destacada (num teste, troque o
    comando por um marcador via `AUTOMASTER_REVISAO_CMD` e confira que o arquivo marcador
    aparece); com `"resume"` ou `"compact"`, não dispara;
  - com `AUTOMASTER_REVISAO=1`, não imprime nada e não dispara;
  - termina em menos de 2 s mesmo com a revisão demorando (o comando marcador dorme 5 s).
- `hooks/hooks.json`: matcher `startup|clear|resume|compact`.

Como fazer:
- Formato do transcript (pesquisa A16): linhas JSON com `type`; chamada de tool em
  `type == "assistant"` → `message.content[]` com `{"type": "tool_use", "name", "input"}`;
  resultado em `type == "user"` → `message.content[]` com `{"type": "tool_result",
  "content", "is_error"}`; `entrypoint` em cada linha. Seja tolerante: campo ausente, pule.
- `revisadas.json`: `{session_id: {"bytes": n, "em": iso}}`; `session_id` é o nome do
  arquivo sem `.jsonl`.
- Prompt ao modelo: em português, peça só relatos sobre o automaster (tools, skills,
  respostas), nos quatro tipos da spec, escritos de forma genérica, no máximo 5, e "[]"
  quando não houver nada; peça JSON puro.
- `check-setup.sh` hoje (`hooks/scripts/check-setup.sh:1-11`): mantenha as duas checagens.
  Acrescente no começo `[ "${AUTOMASTER_REVISAO:-}" = 1 ] && exit 0`. Leia o stdin
  (`entrada=$(cat)`), extraia `source` com o Python do shim. Imprima as lições com
  `"$root/bin/automaster-python.sh" -c 'from automaster_audit import aprendizado;
  print(aprendizado.texto_licoes())'`. Dispare a revisão com
  `nohup "$root/bin/automaster-python.sh" -m automaster_audit.revisao >/dev/null 2>&1 &`
  (ou `AUTOMASTER_REVISAO_CMD` se definido) só em `startup`/`clear`. Sempre `exit 0`.
- O shim já monta `PYTHONPATH` (`bin/automaster-python.sh:4-12`); não crie venv.

---

## Etapa 7 — Limpeza dos ids reais no repositório

Tela: não.

Arquivos:
- mudar os arquivos versionados que têm id real (lista gerada pelo comando abaixo; hoje
  inclui `docs/endpoints.md`, `docs/backlog-arquitetura.md`, `docs/sessao-de-fundo.md`,
  `docs/pendencias-escrita-contato.md`, `docs/vesta/plans/*`, `docs/vesta/research/*`,
  `docs/vesta/specs/*`, `docs/vesta/mockups/2026-10-16-dashboards/**`, `CHANGELOG.md`,
  `CLAUDE.md`, `skills/automaster-leitura/SKILL.md`, `extractor/test/*.test.ts`,
  `extractor/test/fixtures/api-forma.json`, `extractor/src/cli/conversas.ts`,
  `extractor/src/fundo/chrome.ts`, `extractor/src/cli/workflow-editar.ts`,
  `extractor/src/cli/dashboards.ts`)
- criar `auditor/tests/test_sem_ids_reais.py`

O que prova a etapa:
- `test_sem_ids_reais.py` roda `git ls-files` na raiz e, em todo arquivo de texto
  versionado (pule binários e `package-lock.json`), procura palavras de exatamente 20
  alfanuméricos com ao menos uma maiúscula, uma minúscula e um dígito que não comecem por
  `idTeste`; falha listando arquivo:linha:palavra de cada uma fora da lista `PERMITIDOS`
  do próprio teste.
- `PERMITIDOS` só tem palavras que não são id (identificador de código, por exemplo); cada
  entrada com um comentário dizendo o que é.
- as duas suítes e o typecheck do extractor continuam verdes depois da troca.

Como fazer:
- Liste os candidatos:
  `git grep -nowE '[A-Za-z0-9]{20}' | grep -vE 'idTeste'` e filtre os que têm maiúscula,
  minúscula e dígito. Identificador camelCase sem dígito (`tentativaInvisivelMs`) não é id.
- Para cada id real, escolha um marcador `idTeste` + zeros + número, 20 caracteres no total,
  começando em `idTeste0000000000058` (o maior em uso hoje é `...57`; confira com
  `git grep -ohE 'idTeste[0-9]{13}' | sort -u | tail -1`). O mesmo id real vira o mesmo
  marcador em todos os arquivos. Faça a troca com um script Python descartável fora do
  repositório (não commite o script nem o mapa id → marcador: o mapa contém os ids reais).
- Id de 24 hex (ObjectId) e outros formatos ficam fora desta etapa; só os de 20.
- Depois da troca, rode o comando de teste completo e `cd extractor && npm run typecheck`.
  Teste que dependia do valor do id (por exemplo, compara com uma string fixa) é ajustado
  para o marcador.
- Não reescreva o histórico do git.

---

## Etapa 8 — Versão 0.32.0, CHANGELOG e documentação

Tela: não.

Arquivos:
- mudar `.claude-plugin/plugin.json`, `extractor/package.json`, `auditor/pyproject.toml`
  (0.32.0)
- mudar `CHANGELOG.md` (seção `## 0.32.0 — autoevolução`)
- mudar `CLAUDE.md`
- mudar `auditor/tests/test_release_0_31_0.py`
- criar `auditor/tests/test_release_0_32_0.py`

O que prova a etapa:
- `auditor/tests/test_versoes.py` verde com 0.32.0 nos três manifestos e a seção no
  CHANGELOG.
- `test_release_0_31_0.py` deixa de exigir que os manifestos estejam em 0.31.0 (o teste
  `test_os_tres_manifestos_estao_em_0_31_0` sai; os demais, que conferem o conteúdo da
  seção 0.31.0, ficam) e a contagem de tools que ele exige passa a 37.
- `test_release_0_32_0.py` confere que a seção 0.32.0 do CHANGELOG cita `relatar`,
  `aprendizados`, "issue", "lição" e o código do `ToolError`; e que o `CLAUDE.md` diz
  "trinta e sete" (ou "37 tools"), cita `relatar` na lista de tools, cita
  `AUTOMASTER_APRENDIZADOS` e tem um parágrafo em "Pontos críticos" sobre a autoevolução.
- toda a suíte verde.

Como fazer:
- CHANGELOG no formato das seções vizinhas (`CHANGELOG.md:7-…`): o que o usuário ganha
  (lição vale na hora; issue sozinha, limpa e única; servidor não cai mais com erro
  inesperado), o que mudou por dentro (código no `ToolError`, revisão em segundo plano,
  matcher do hook), e as limitações: repo público, filtro mascara a mais, a revisão usa a
  cota de quem está logado ou a chave de API se houver, sessão viva não é revisada.
- `CLAUDE.md`: contagem e lista de tools (linha 24), módulo `aprendizado` na lista de
  módulos do `mcp/`, e um ponto crítico curto: onde ficam os aprendizados, os códigos do
  `ToolError` e a regra "todo `raise ToolError` declara `codigo=`", que o registro
  automático só relata `falha` e `extractor:http_*`/`erro`, e que o repo é público (nada de
  id real em arquivo versionado; o teste barra).
