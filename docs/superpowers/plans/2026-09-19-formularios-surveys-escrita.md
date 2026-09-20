# Escrita e personalização visual de formulários e surveys — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar, editar e estilizar formulários e surveys de uma subconta GHL pelo automaster, com slides do survey como entidade de primeira classe e identidade visual por cliente.

**Architecture:** o documento do formulário é baixado inteiro, transformado por um motor de operações declaradas puro (sem rede) e republicado inteiro num POST. O motor e a tradução de tokens em estilo são funções puras testadas com `node --test`; a rede fica num módulo de API à parte; o CLI é uma casca que junta os dois e grava o rastro.

**Tech Stack:** TypeScript + Playwright (extractor), Python 3.12 + pytest (auditor/MCP), `node --test` via `tsx` para os testes do extractor — sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-19-formularios-surveys-escrita-design.md`

**Pesquisa:** `docs/superpowers/research/2026-09-19-formularios-surveys-escrita-research.md`

## Global Constraints

- Host de formulários e surveys: `https://services.leadconnectorhq.com`. A migração da leitura (hoje `https://backend.leadconnectorhq.com`, `extractor/src/api/forms.ts:8`) só vale se as seis rotas de leitura devolverem o mesmo nos dois hosts (Tarefa 1). Divergência cancela a migração e a leitura fica em `backend.`.
- Toda escrita exige `--confirmo` (CLI) / `confirmo=true` (MCP) e grava rastro com `registroEscrita(loc, "_formularios", chave, dados)` (`extractor/src/cli.ts:531-537`), no padrão de duas fases: grava `aplicado:false` antes, reescreve com `aplicado:true` e a resposta, ou com `erro` no catch (modelo em `extractor/src/cli.ts:1005-1031`).
- O caminho do rastro vai para o stderr como `snapshot: <caminho>`, exatamente com esse prefixo — `_head_tail` do MCP preserva essas linhas ao truncar (`auditor/src/automaster_audit/mcp_server.py:220-234`).
- Com `--json`, `log` é `console.error` e só a última linha do stdout é JSON.
- O automaster nunca escreve em `form.fieldCSS` nem em `form.mobileFieldCSS`.
- Cor no documento do GHL: hex de 8 dígitos, sem `#`, ex.: `"2c3345FF"`.
- Subconta de validação: `Xb9gDxwxYhdqtprGcb5E` (Instaltech). `WPIUKW3L4lDyMhLhKYKG` devolve 401 e não serve de cobaia.
- Verificação antes de cada commit: `npx tsc --noEmit` em `extractor/`; `.venv/bin/python -m pytest -q` em `auditor/` (222 testes hoje); `npm test` em `extractor/` a partir da Tarefa 2.
- Versão do plugin ao fim: `0.12.0` em `.claude-plugin/plugin.json`, com entrada no `CHANGELOG.md`.

## Estrutura de arquivos

| arquivo | responsabilidade |
| --- | --- |
| `extractor/src/api/forms.ts` | leitura (existe). Só muda a constante `BASE` na Tarefa 1. |
| `extractor/src/api/forms-write.ts` | rede da escrita: criar, atualizar, apagar, duplicar, restaurar versão, paleta, temas, baixar documento de versão. |
| `extractor/src/forms/doc.ts` | motor de operações puro sobre o documento. Sem rede, sem fs. |
| `extractor/src/forms/style.ts` | tradução de tokens em `fieldStyle`/`style`/`footerStyle`/`customStyle`. Puro. |
| `extractor/src/forms/diff.ts` | diferença legível entre dois documentos, para a prévia. Puro. |
| `extractor/test/doc.test.ts` | testes do motor. |
| `extractor/test/style.test.ts` | testes da tradução de tokens e do diff. |
| `extractor/src/cli.ts` | runners `runFormularioAcao` e `runFormularioEstilo` + registro dos comandos. |
| `auditor/src/automaster_audit/mcp_server.py` | tools `formulario_acao` e `formulario_estilo`. |
| `auditor/tests/test_mcp_formularios_escrita.py` | testes das duas tools, sem rede. |
| `skills/automaster-formulario-visual/SKILL.md` | a skill de estética. |
| `docs/endpoints.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`, `CLAUDE.md` | documentação e versão. |

---

### Task 1: módulo de rede da escrita e migração de host

**Files:**
- Create: `extractor/src/api/forms-write.ts`
- Modify: `extractor/src/api/forms.ts:8`
- Modify: `extractor/package.json` (script `formulario-acao`, ainda sem uso — entra na Tarefa 4; nesta tarefa só o módulo)

**Interfaces:**
- Consumes: `GhlClient` de `extractor/src/api/client.ts` (`getJson`, `postJson`, `deleteJson`, `getJsonNoAuth`).
- Produces: as funções abaixo, usadas pelas Tarefas 4, 5 e 6.

- [ ] **Step 1: escrever o módulo de rede**

Crie `extractor/src/api/forms-write.ts`:

```ts
import type { GhlClient } from "./client.js";

/**
 * Escrita de formulários e surveys. Host `services.` — é o que o app usa
 * (FORM_SERVER_URL no bundle do builder). Rotas em docs/endpoints.md,
 * seção `## Formulários e surveys`.
 *
 * O documento inteiro vai no corpo do POST; o servidor grava a versão no
 * Cloud Storage sozinho e devolve o `versionHistory` atualizado.
 */
const BASE = "https://services.leadconnectorhq.com";

export type Tipo = "formulario" | "survey";

/** `forms` ou `surveys` — o segmento de rota de cada tipo. */
function rota(tipo: Tipo): string {
  return tipo === "survey" ? "surveys" : "forms";
}

export interface CriarOpts {
  locationId: string;
  productType: "Form" | "Survey" | "Quiz";
  parentId?: string;
}

/** Cria o objeto vazio e devolve a resposta crua (traz `form._id`). */
export function criar(client: GhlClient, tipo: Tipo, o: CriarOpts): Promise<unknown> {
  return client.postJson(`${BASE}/${rota(tipo)}/`, {
    locationId: o.locationId,
    productType: o.productType,
    source: "landing_page",
    ...(o.parentId ? { parentId: o.parentId } : {}),
  });
}

/** Republica o documento inteiro. É POST, não PUT. */
export function publicar(
  client: GhlClient, tipo: Tipo, id: string, nome: string, formData: unknown,
): Promise<unknown> {
  return client.postJson(`${BASE}/${rota(tipo)}/${encodeURIComponent(id)}`, { name: nome, formData });
}

export function apagar(client: GhlClient, tipo: Tipo, id: string): Promise<unknown> {
  return client.deleteJson(`${BASE}/${rota(tipo)}/${encodeURIComponent(id)}`);
}

export function duplicar(
  client: GhlClient, tipo: Tipo, id: string, nome: string, folderId?: string,
): Promise<unknown> {
  return client.postJson(`${BASE}/${rota(tipo)}/duplicate/${encodeURIComponent(id)}`, {
    name: nome, ...(folderId ? { folderId } : {}),
  });
}

/** Volta o objeto para uma versão do `versionHistory`. */
export function restaurarVersao(
  client: GhlClient, tipo: Tipo, id: string, versionId: string,
): Promise<unknown> {
  const chave = tipo === "survey" ? "surveyId" : "formId";
  return client.postJson(`${BASE}/${rota(tipo)}/restore-version`, { [chave]: id, versionId });
}

/**
 * Documento de uma versão. A URL do `versionHistory` é pública no Cloud
 * Storage: baixa SEM auth, como os steps de workflow.
 */
export function baixarVersao(client: GhlClient, url: string): Promise<unknown> {
  return client.getJsonNoAuth(url);
}

export function paletaPadrao(client: GhlClient, locationId: string): Promise<unknown> {
  return client.getJson(`${BASE}/forms/default-colors?locationId=${encodeURIComponent(locationId)}`);
}

export function gravarPaletaPadrao(
  client: GhlClient, locationId: string, colors: unknown,
): Promise<unknown> {
  return client.postJson(`${BASE}/forms/default-colors`, { locationId, colors });
}

export function temas(client: GhlClient, tipo: Tipo, locationId: string): Promise<unknown> {
  return client.getJson(`${BASE}/${rota(tipo)}/themes?locationId=${encodeURIComponent(locationId)}`);
}

export function tema(
  client: GhlClient, tipo: Tipo, locationId: string, themeId: string,
): Promise<unknown> {
  return client.getJson(
    `${BASE}/${rota(tipo)}/theme-style/${encodeURIComponent(themeId)}?locationId=${encodeURIComponent(locationId)}`,
  );
}
```

- [ ] **Step 2: typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: comparar os dois hosts ao vivo, antes de migrar a leitura**

Rode a leitura como está (host `backend.`) e guarde:

```bash
cd extractor
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o lista --json > /tmp/backend-forms.json
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o lista --tipo survey --json > /tmp/backend-surveys.json
```

Troque `BASE` em `extractor/src/api/forms.ts:8` para `https://services.leadconnectorhq.com` e rode de novo para `/tmp/services-*.json`. Compare:

```bash
diff <(jq -S . /tmp/backend-forms.json) <(jq -S . /tmp/services-forms.json)
diff <(jq -S . /tmp/backend-surveys.json) <(jq -S . /tmp/services-surveys.json)
```

Expected: sem diferença. Repita para `-o detalhe -i <id de um formulário>`, `-o detalhe --tipo survey -i <id>` e `-o submissoes`.

Qualquer divergência: reverta `BASE` para `backend.`, registre o que divergiu numa linha em `docs/endpoints.md` e siga. A escrita continua em `services.` de qualquer jeito.

- [ ] **Step 4: commit**

```bash
git add extractor/src/api/forms-write.ts extractor/src/api/forms.ts
git commit -m "feat(extractor): módulo de escrita de formulários e surveys"
```

---

### Task 2: motor de operações sobre o documento

**Files:**
- Create: `extractor/src/forms/doc.ts`
- Create: `extractor/test/doc.test.ts`
- Modify: `extractor/package.json` (script `test`)

**Interfaces:**
- Consumes: nada. Módulo puro.
- Produces:
  - `type Doc = Record<string, any>` — o `formData` de um formulário ou survey.
  - `ehSurvey(doc: Doc): boolean`
  - `listasDeCampos(doc: Doc): { slideId?: string; campos: any[] }[]`
  - `aplicar(doc: Doc, ops: Op[], opts?: { permitirSemBotao?: boolean }): Doc`
  - `type Op` — a união discriminada das operações.

- [ ] **Step 1: escrever os testes que falham**

Crie `extractor/test/doc.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, ehSurvey, listasDeCampos, type Doc } from "../src/forms/doc.js";

const campo = (tag: string, label = tag) => ({ tag, label, type: "text", standard: true, required: false });
const botao = () => ({ tag: "button", type: "submit", label: "Enviar" });

const form = (): Doc => ({ form: { fields: [campo("full_name", "Nome"), campo("email", "E-mail"), botao()] } });
const survey = (): Doc => ({
  form: {},
  slides: [
    { id: "s1", slideName: "Slide 1", button: {}, slideData: [campo("full_name", "Nome")] },
    { id: "s2", slideName: "Slide 2", button: {}, slideData: [campo("email", "E-mail")] },
  ],
});

test("reconhece survey pelo slides", () => {
  assert.equal(ehSurvey(survey()), true);
  assert.equal(ehSurvey(form()), false);
});

test("lista de campos do formulário é uma só, sem slide", () => {
  const l = listasDeCampos(form());
  assert.equal(l.length, 1);
  assert.equal(l[0].slideId, undefined);
  assert.equal(l[0].campos.length, 3);
});

test("lista de campos do survey é uma por slide", () => {
  const l = listasDeCampos(survey());
  assert.deepEqual(l.map((x) => x.slideId), ["s1", "s2"]);
});

test("adicionar campo entra no fim da lista, antes do botão", () => {
  const d = aplicar(form(), [{ op: "adicionar-campo", campo: campo("phone", "Telefone") }]);
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["full_name", "email", "phone", "button"]);
});

test("adicionar campo em survey exige slide existente", () => {
  assert.throws(
    () => aplicar(survey(), [{ op: "adicionar-campo", campo: campo("phone"), slide: "naoexiste" }]),
    /slide naoexiste não existe/,
  );
});

test("adicionar campo em survey sem slide vai para o último", () => {
  const d = aplicar(survey(), [{ op: "adicionar-campo", campo: campo("phone") }]);
  assert.deepEqual(d.slides[1].slideData.map((f: any) => f.tag), ["email", "phone"]);
});

test("remover campo por tag", () => {
  const d = aplicar(form(), [{ op: "remover-campo", alvo: "email" }]);
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["full_name", "button"]);
});

test("remover campo inexistente é erro, não silêncio", () => {
  assert.throws(() => aplicar(form(), [{ op: "remover-campo", alvo: "cep" }]), /cep não existe/);
});

test("remover o botão de envio é recusado sem permissão explícita", () => {
  assert.throws(() => aplicar(form(), [{ op: "remover-campo", alvo: "button" }]), /sem botão de envio/);
});

test("remover o botão passa com permitirSemBotao", () => {
  const d = aplicar(form(), [{ op: "remover-campo", alvo: "button" }], { permitirSemBotao: true });
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["full_name", "email"]);
});

test("esvaziar o documento é recusado", () => {
  assert.throws(
    () => aplicar(form(), [
      { op: "remover-campo", alvo: "full_name" },
      { op: "remover-campo", alvo: "email" },
    ]),
    /sem nenhum campo/,
  );
});

test("renomear troca o label e mantém a tag", () => {
  const d = aplicar(form(), [{ op: "renomear-campo", alvo: "email", label: "Seu melhor e-mail" }]);
  assert.equal(d.form.fields[1].label, "Seu melhor e-mail");
  assert.equal(d.form.fields[1].tag, "email");
});

test("reordenar põe os nomeados na ordem dada e preserva o resto", () => {
  const d = aplicar(form(), [{ op: "reordenar-campos", ordem: ["email", "full_name"] }]);
  assert.deepEqual(d.form.fields.map((f: any) => f.tag), ["email", "full_name", "button"]);
});

test("criar slide entra no fim e ganha id único", () => {
  const d = aplicar(survey(), [{ op: "criar-slide", nome: "Slide 3" }]);
  assert.equal(d.slides.length, 3);
  assert.equal(d.slides[2].slideName, "Slide 3");
  assert.equal(new Set(d.slides.map((s: any) => s.id)).size, 3);
  assert.deepEqual(d.slides[2].slideData, []);
});

test("criar slide em formulário é erro", () => {
  assert.throws(() => aplicar(form(), [{ op: "criar-slide", nome: "x" }]), /só existe em survey/);
});

test("remover o último slide é recusado", () => {
  const d = aplicar(survey(), [{ op: "remover-slide", alvo: "s2" }]);
  assert.equal(d.slides.length, 1);
  assert.throws(() => aplicar(d, [{ op: "remover-slide", alvo: "s1" }]), /sem nenhum slide/);
});

test("mover campo entre slides", () => {
  const d = aplicar(survey(), [{ op: "mover-campo", alvo: "full_name", paraSlide: "s2" }]);
  assert.deepEqual(d.slides[0].slideData, []);
  assert.deepEqual(d.slides[1].slideData.map((f: any) => f.tag), ["email", "full_name"]);
});

test("reordenar slides", () => {
  const d = aplicar(survey(), [{ op: "reordenar-slides", ordem: ["s2", "s1"] }]);
  assert.deepEqual(d.slides.map((s: any) => s.id), ["s2", "s1"]);
});

test("renomear slide", () => {
  const d = aplicar(survey(), [{ op: "renomear-slide", alvo: "s1", nome: "Dados" }]);
  assert.equal(d.slides[0].slideName, "Dados");
});

test("definir valores de navegação", () => {
  const d = aplicar(survey(), [{ op: "definir", caminho: "form.isProgressBarEnabled", valor: true }]);
  assert.equal(d.form.isProgressBarEnabled, true);
});

test("definir recusa fieldCSS", () => {
  assert.throws(
    () => aplicar(form(), [{ op: "definir", caminho: "form.fieldCSS", valor: "a{}" }]),
    /gerado pelo builder/,
  );
});

test("aplicar não muda o documento de entrada", () => {
  const d0 = form();
  aplicar(d0, [{ op: "remover-campo", alvo: "email" }]);
  assert.equal(d0.form.fields.length, 3);
});

test("campo que o motor não entende sobrevive intacto", () => {
  const d0 = form();
  d0.form.fields.push({ tag: "coisa_nova_do_ghl", propriedadeDesconhecida: 42 });
  const d = aplicar(d0, [{ op: "renomear-campo", alvo: "email", label: "x" }]);
  assert.deepEqual(d.form.fields.at(-1), { tag: "coisa_nova_do_ghl", propriedadeDesconhecida: 42 });
});
```

- [ ] **Step 2: registrar o runner de teste e rodar para ver falhar**

Em `extractor/package.json`, dentro de `scripts`, acrescente:

```json
    "test": "tsx --test test/*.test.ts",
```

Run: `cd extractor && npm test`
Expected: FAIL — `Cannot find module '../src/forms/doc.js'`.

- [ ] **Step 3: escrever o motor**

Crie `extractor/src/forms/doc.ts`:

```ts
/**
 * Motor de operações sobre o documento de formulário ou survey. Puro: sem
 * rede, sem fs. O documento de entrada nunca é mutado.
 *
 * Formulário: campos em `form.fields` (lista plana).
 * Survey: campos em `slides[].slideData`, um por slide.
 *
 * A lista de campos tem também o botão de envio (`tag:"button"`), blocos de
 * texto (`tag:"header"`) e o aceite de termos — por isso remover exige nomear
 * o alvo, nunca a posição.
 */

// o documento vem do GHL e tem dezenas de campos que não modelamos; `any` aqui
// é deliberado: o que não entendemos precisa atravessar intacto
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Doc = Record<string, any>;

export type Op =
  | { op: "adicionar-campo"; campo: any; slide?: string; posicao?: number }
  | { op: "remover-campo"; alvo: string }
  | { op: "renomear-campo"; alvo: string; label: string }
  | { op: "reordenar-campos"; ordem: string[]; slide?: string }
  | { op: "mover-campo"; alvo: string; paraSlide: string }
  | { op: "criar-slide"; nome: string; posicao?: number }
  | { op: "remover-slide"; alvo: string }
  | { op: "renomear-slide"; alvo: string; nome: string }
  | { op: "reordenar-slides"; ordem: string[] }
  | { op: "definir"; caminho: string; valor: unknown };

/** Elementos da lista que não são campo de dado. */
const NAO_CAMPO = new Set(["button", "header", "terms_and_conditions"]);

const CAMINHO_PROIBIDO = /^form\.(mobileF|f)ieldCSS$/;

export function ehSurvey(doc: Doc): boolean {
  return Array.isArray(doc.slides);
}

/** A lista (ou listas, no survey) onde os campos moram. */
export function listasDeCampos(doc: Doc): { slideId?: string; campos: any[] }[] {
  if (ehSurvey(doc)) {
    return doc.slides.map((s: any) => ({ slideId: s.id, campos: s.slideData ?? [] }));
  }
  return [{ campos: doc.form?.fields ?? [] }];
}

/** Identificador de um campo dentro da lista: `tag` é o que o GHL usa. */
function identifica(campo: any): string {
  return String(campo?.tag ?? campo?.id ?? "");
}

function clonar<T>(v: T): T {
  return structuredClone(v);
}

function slidePorId(doc: Doc, id: string): any {
  const s = doc.slides.find((x: any) => x.id === id);
  if (!s) throw new Error(`slide ${id} não existe neste survey`);
  return s;
}

/** Onde o campo `alvo` está; erro se não estiver em lugar nenhum. */
function acharCampo(doc: Doc, alvo: string): { lista: any[]; indice: number } {
  for (const { campos } of listasDeCampos(doc)) {
    const i = campos.findIndex((c) => identifica(c) === alvo);
    if (i >= 0) return { lista: campos, indice: i };
  }
  throw new Error(`campo ${alvo} não existe neste documento`);
}

function validar(doc: Doc, permitirSemBotao: boolean, permitirVazio: boolean): void {
  const todos = listasDeCampos(doc).flatMap((l) => l.campos);
  const campos = todos.filter((c) => !NAO_CAMPO.has(identifica(c)));
  if (campos.length === 0 && !permitirVazio) {
    throw new Error(
      "a operação deixaria o documento sem nenhum campo — um formulário assim recebe " +
      "visita e não coleta nada. Se é isso mesmo, repita com --permitir-vazio.",
    );
  }
  if (!permitirSemBotao && !todos.some((c) => identifica(c) === "button")) {
    throw new Error(
      "a operação deixaria o documento sem botão de envio — ele continua no ar e nenhum " +
      "lead consegue enviar. Se é isso mesmo, repita com --permitir-sem-botao.",
    );
  }
  if (ehSurvey(doc) && doc.slides.length === 0) {
    throw new Error("a operação deixaria o survey sem nenhum slide");
  }
}

export function aplicar(
  entrada: Doc, ops: Op[], opts: { permitirSemBotao?: boolean; permitirVazio?: boolean } = {},
): Doc {
  const doc = clonar(entrada);

  for (const o of ops) {
    switch (o.op) {
      case "adicionar-campo": {
        let lista: any[];
        if (ehSurvey(doc)) {
          const s = o.slide ? slidePorId(doc, o.slide) : doc.slides.at(-1);
          s.slideData ??= [];
          lista = s.slideData;
        } else {
          doc.form ??= {};
          doc.form.fields ??= [];
          lista = doc.form.fields;
        }
        const iBotao = lista.findIndex((c) => identifica(c) === "button");
        const pos = o.posicao ?? (iBotao >= 0 ? iBotao : lista.length);
        lista.splice(pos, 0, clonar(o.campo));
        break;
      }
      case "remover-campo": {
        const { lista, indice } = acharCampo(doc, o.alvo);
        lista.splice(indice, 1);
        break;
      }
      case "renomear-campo": {
        const { lista, indice } = acharCampo(doc, o.alvo);
        lista[indice].label = o.label;
        break;
      }
      case "reordenar-campos": {
        const alvo = ehSurvey(doc)
          ? (o.slide ? slidePorId(doc, o.slide) : doc.slides[0]).slideData
          : doc.form.fields;
        const nomeados = o.ordem.map((t) => {
          const c = alvo.find((x: any) => identifica(x) === t);
          if (!c) throw new Error(`campo ${t} não existe neste documento`);
          return c;
        });
        const resto = alvo.filter((c: any) => !o.ordem.includes(identifica(c)));
        alvo.splice(0, alvo.length, ...nomeados, ...resto);
        break;
      }
      case "mover-campo": {
        if (!ehSurvey(doc)) throw new Error("mover campo entre slides só existe em survey");
        const destino = slidePorId(doc, o.paraSlide);
        const { lista, indice } = acharCampo(doc, o.alvo);
        const [c] = lista.splice(indice, 1);
        destino.slideData ??= [];
        destino.slideData.push(c);
        break;
      }
      case "criar-slide": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        const id = `${Date.now()}-${doc.slides.length}`;
        const novo = { id, slideName: o.nome, button: clonar(doc.slides.at(-1)?.button ?? {}), slideData: [] };
        doc.slides.splice(o.posicao ?? doc.slides.length, 0, novo);
        break;
      }
      case "remover-slide": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        const i = doc.slides.findIndex((s: any) => s.id === o.alvo);
        if (i < 0) throw new Error(`slide ${o.alvo} não existe neste survey`);
        doc.slides.splice(i, 1);
        break;
      }
      case "renomear-slide": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        slidePorId(doc, o.alvo).slideName = o.nome;
        break;
      }
      case "reordenar-slides": {
        if (!ehSurvey(doc)) throw new Error("slide só existe em survey");
        const nomeados = o.ordem.map((id) => slidePorId(doc, id));
        const resto = doc.slides.filter((s: any) => !o.ordem.includes(s.id));
        doc.slides = [...nomeados, ...resto];
        break;
      }
      case "definir": {
        if (CAMINHO_PROIBIDO.test(o.caminho)) {
          throw new Error(
            `${o.caminho} é gerado pelo builder a partir de form.fieldStyle: o que for escrito ` +
            "aqui some assim que alguém abrir o formulário na interface. Use fieldStyle ou customStyle.",
          );
        }
        const partes = o.caminho.split(".");
        let alvo: any = doc;
        for (const p of partes.slice(0, -1)) {
          alvo[p] ??= {};
          alvo = alvo[p];
        }
        alvo[partes.at(-1)!] = o.valor;
        break;
      }
    }
  }

  validar(doc, opts.permitirSemBotao ?? false, opts.permitirVazio ?? false);
  return doc;
}
```

- [ ] **Step 4: rodar os testes**

Run: `cd extractor && npm test`
Expected: PASS em todos.

- [ ] **Step 5: typecheck e commit**

```bash
cd extractor && npx tsc --noEmit
git add extractor/src/forms/doc.ts extractor/test/doc.test.ts extractor/package.json
git commit -m "feat(extractor): motor de operações sobre documento de formulário e survey"
```

---

### Task 2b: lógica condicional entre slides

**Files:**
- Modify: `extractor/src/forms/doc.ts`
- Modify: `extractor/test/doc.test.ts`
- Modify: `docs/endpoints.md`

A spec deixou esta peça explicitamente em aberto: o formato da lógica condicional não apareceu em nenhum documento examinado. Esta tarefa descobre o formato antes de modelá-lo, porque modelar às cegas produz documento que o GHL recusa ou ignora.

- [ ] **Step 1: descobrir o formato**

No survey descartável da Tarefa 9 (ou num survey de teste criado só para isto), monte uma regra condicional pela interface do GHL — "se a resposta do campo X for Y, pule para o slide 3". Baixe o documento resultante:

```bash
cd extractor
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o detalhe --tipo survey -i <surveyId> --json \
  | jq '.versionHistory[-1].surveyDataDownloadUrl' -r \
  | xargs curl -s -o /tmp/survey-com-logica.json
jq 'keys, .slides[0] | keys' /tmp/survey-com-logica.json
```

Compare com um documento sem regra alguma. O que apareceu é o formato. Anote-o em `docs/endpoints.md`, na seção de formulários e surveys.

- [ ] **Step 2: escrever o teste da operação, com o formato real**

Acrescente a `extractor/test/doc.test.ts` um teste que aplica `{ op: "definir-logica", slide: "s1", regras: [...] }` com a estrutura descoberta e confere que ela aterrissou no lugar certo do documento, e um teste que recusa regra apontando para slide inexistente.

- [ ] **Step 3: rodar para ver falhar**

Run: `cd extractor && npm test`
Expected: FAIL — operação desconhecida.

- [ ] **Step 4: implementar a operação**

Acrescente `{ op: "definir-logica"; slide: string; regras: unknown[] }` ao tipo `Op` e o `case` correspondente em `aplicar`, escrevendo no caminho descoberto no passo 1 e validando que todo slide de destino citado nas regras existe.

- [ ] **Step 5: rodar, typecheck e commit**

```bash
cd extractor && npm test && npx tsc --noEmit
git add extractor/src/forms/doc.ts extractor/test/doc.test.ts docs/endpoints.md
git commit -m "feat(extractor): lógica condicional entre slides do survey"
```

---

### Task 3: tokens em estilo, e a prévia

**Files:**
- Create: `extractor/src/forms/style.ts`
- Create: `extractor/src/forms/diff.ts`
- Create: `extractor/test/style.test.ts`

**Interfaces:**
- Consumes: `Doc`, `Op` de `extractor/src/forms/doc.ts`.
- Produces:
  - `type Tokens` — a forma que a skill visual produz.
  - `cor(hex: string): string` — `#2c3345` → `2c3345FF`.
  - `opsDeEstilo(doc: Doc, t: Tokens): Op[]`
  - `paletaDeTokens(t: Tokens): Record<string, string>` — o corpo de `POST /forms/default-colors`.
  - `diferenca(antes: Doc, depois: Doc): string[]` — linhas legíveis para a prévia.

- [ ] **Step 1: escrever os testes que falham**

Crie `extractor/test/style.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cor, opsDeEstilo, paletaDeTokens, type Tokens } from "../src/forms/style.js";
import { diferenca } from "../src/forms/diff.js";
import { aplicar, type Doc } from "../src/forms/doc.js";

const tokens: Tokens = {
  corPrimaria: "#0f62fe",
  corTexto: "#161616",
  corFundo: "#ffffff",
  corBorda: "#8d8d8d",
  corErro: "#da1e28",
  fonte: "IBM Plex Sans",
  tamanhoRotulo: 14,
  pesoRotulo: 600,
  radius: 4,
  espacamento: 16,
  cssLivre: ".hl-error { font-weight: 600 }",
};

test("cor vira hex de 8 dígitos sem cerquilha", () => {
  assert.equal(cor("#0f62fe"), "0f62feFF");
  assert.equal(cor("0f62fe"), "0f62feFF");
  assert.equal(cor("#0f62fe80"), "0f62fe80");
});

test("cor recusa valor que não é hex", () => {
  assert.throws(() => cor("azul"), /hex/);
});

test("tokens viram operações de estilo, nunca em fieldCSS", () => {
  const ops = opsDeEstilo({ form: { fields: [] } }, tokens);
  const caminhos = ops.map((o: any) => o.caminho);
  assert.ok(caminhos.includes("form.fieldStyle.fontColor"));
  assert.ok(caminhos.includes("form.customStyle"));
  assert.ok(!caminhos.some((c: string) => c.includes("fieldCSS")));
});

test("survey também recebe o rodapé de navegação", () => {
  const ops = opsDeEstilo({ form: {}, slides: [{ id: "s1", slideData: [] }] }, tokens);
  const caminhos = ops.map((o: any) => o.caminho);
  assert.ok(caminhos.some((c: string) => c.startsWith("form.footerStyle")));
});

test("formulário não recebe rodapé de navegação", () => {
  const ops = opsDeEstilo({ form: { fields: [] } }, tokens);
  assert.ok(!ops.some((o: any) => o.caminho.startsWith("form.footerStyle")));
});

test("paleta da subconta sai dos mesmos tokens", () => {
  const p = paletaDeTokens(tokens);
  assert.equal(p.primary, "0f62feFF");
});

const base = (): Doc => ({
  form: { fields: [{ tag: "email", label: "E-mail" }, { tag: "button", type: "submit" }], fieldStyle: { fontColor: "000000FF" } },
});

test("a prévia nomeia campo que entra, campo que sai e estilo alterado", () => {
  const antes = base();
  const depois = aplicar(antes, [
    { op: "adicionar-campo", campo: { tag: "phone", label: "Telefone" } },
    { op: "remover-campo", alvo: "email" },
    { op: "definir", caminho: "form.fieldStyle.fontColor", valor: "161616FF" },
  ]);
  const linhas = diferenca(antes, depois);
  assert.ok(linhas.some((l) => l.includes("+ campo phone")));
  assert.ok(linhas.some((l) => l.includes("- campo email")));
  assert.ok(linhas.some((l) => l.includes("form.fieldStyle.fontColor")));
});

test("documento igual não tem diferença", () => {
  assert.deepEqual(diferenca(base(), base()), []);
});
```

- [ ] **Step 2: rodar para ver falhar**

Run: `cd extractor && npm test`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: implementar `style.ts`**

```ts
import type { Doc, Op } from "./doc.js";
import { ehSurvey } from "./doc.js";

/**
 * Tokens de identidade visual, produzidos pela skill
 * `automaster-formulario-visual`, traduzidos aqui para o que o GHL guarda.
 *
 * Só dois destinos: `form.fieldStyle` (o painel do builder, que sobrevive a
 * edição na interface) e `form.customStyle` (CSS livre). `fieldCSS` é gerado
 * pelo builder e nunca recebe escrita nossa.
 */
export interface Tokens {
  corPrimaria: string;
  corTexto: string;
  corFundo: string;
  corBorda: string;
  corErro: string;
  fonte: string;
  tamanhoRotulo: number;
  pesoRotulo: number;
  radius: number;
  espacamento: number;
  cssLivre?: string;
}

const HEX = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

/** `#0f62fe` → `0f62feFF`. O GHL guarda cor em 8 dígitos, sem cerquilha. */
export function cor(v: string): string {
  const m = HEX.exec(v.trim());
  if (!m) throw new Error(`cor inválida: ${v}. Use hex, ex.: #0f62fe`);
  return `${m[1]}${m[2] ?? "FF"}`;
}

export function opsDeEstilo(doc: Doc, t: Tokens): Op[] {
  const def = (caminho: string, valor: unknown): Op => ({ op: "definir", caminho, valor });
  const ops: Op[] = [
    def("form.fieldStyle.bgColor", cor(t.corFundo)),
    def("form.fieldStyle.fontColor", cor(t.corTexto)),
    def("form.fieldStyle.labelColor", cor(t.corTexto)),
    def("form.fieldStyle.labelFontFamily", t.fonte),
    def("form.fieldStyle.labelFontSize", t.tamanhoRotulo),
    def("form.fieldStyle.labelFontWeight", t.pesoRotulo),
    def("form.fieldStyle.placeholderColor", cor(t.corBorda)),
    def("form.fieldStyle.border.color", cor(t.corBorda)),
    def("form.fieldStyle.border.radius", t.radius),
    def("form.fieldStyle.padding", {
      top: Math.round(t.espacamento / 2), bottom: Math.round(t.espacamento / 2),
      left: Math.round(t.espacamento / 2), right: Math.round(t.espacamento / 2),
    }),
    def("form.style.fieldSpacing", t.espacamento),
    def("form.style.background", cor(t.corFundo)),
    def("form.submitMessageStyle.fontColor", cor(t.corTexto)),
    def("form.customStyle", t.cssLivre ?? ""),
  ];
  if (ehSurvey(doc)) {
    ops.push(
      def("form.footerStyle.backgroundFill", cor(t.corFundo)),
      def("form.footerStyle.buttonStyle.fontColor", cor(t.corFundo)),
      def("form.footerStyle.buttonStyle.nextButtonBgColor", cor(t.corPrimaria)),
      def("form.footerStyle.buttonStyle.submitButtonBgColor", cor(t.corPrimaria)),
      def("form.footerStyle.buttonStyle.backButtonBgColor", cor(t.corBorda)),
    );
  }
  return ops;
}

/** Corpo de `POST /forms/default-colors`: a paleta padrão da subconta. */
export function paletaDeTokens(t: Tokens): Record<string, string> {
  return {
    primary: cor(t.corPrimaria),
    text: cor(t.corTexto),
    background: cor(t.corFundo),
    border: cor(t.corBorda),
    error: cor(t.corErro),
  };
}
```

Nota: as chaves de `paletaDeTokens` são uma hipótese. Antes de gravar a paleta ao vivo (Tarefa 5), leia `GET /forms/default-colors` de uma subconta que já tenha uma e ajuste as chaves ao que o servidor devolve. Se as chaves divergirem, corrija aqui e no teste.

- [ ] **Step 4: implementar `diff.ts`**

```ts
import type { Doc } from "./doc.js";
import { listasDeCampos } from "./doc.js";

/** Achata o documento em caminho → valor, ignorando as listas de campos. */
function achatar(o: unknown, prefixo = "", fora: string[] = []): Record<string, string> {
  const r: Record<string, string> = {};
  if (o === null || typeof o !== "object" || Array.isArray(o)) {
    if (prefixo) r[prefixo] = JSON.stringify(o);
    return r;
  }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const caminho = prefixo ? `${prefixo}.${k}` : k;
    if (fora.includes(caminho)) continue;
    Object.assign(r, achatar(v, caminho, fora));
  }
  return r;
}

const IGNORAR = ["form.fields", "slides", "form.fieldCSS", "form.mobileFieldCSS"];

/** Linhas legíveis do que muda entre dois documentos. Lista vazia = nada muda. */
export function diferenca(antes: Doc, depois: Doc): string[] {
  const linhas: string[] = [];

  const tags = (d: Doc) => listasDeCampos(d).flatMap((l) =>
    l.campos.map((c: any) => `${l.slideId ? `${l.slideId}/` : ""}${c.tag ?? c.id}`));

  const rotulos = (d: Doc) => Object.fromEntries(
    listasDeCampos(d).flatMap((l) => l.campos.map((c: any) => [c.tag ?? c.id, c.label])));
  const a = tags(antes);
  const b = tags(depois);
  for (const t of b) if (!a.includes(t)) linhas.push(`+ campo ${t}`);
  for (const t of a) if (!b.includes(t)) linhas.push(`- campo ${t}`);
  if (a.length === b.length && a.join() !== b.join() && !linhas.length) {
    linhas.push(`~ ordem dos campos: ${a.join(", ")} → ${b.join(", ")}`);
  }

  const ra = rotulos(antes);
  const rb = rotulos(depois);
  for (const [t, r] of Object.entries(rb)) {
    if (t in ra && ra[t] !== r) linhas.push(`~ rótulo de ${t}: ${ra[t]} → ${r}`);
  }

  const fa = achatar(antes, "", IGNORAR);
  const fb = achatar(depois, "", IGNORAR);
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (fa[k] !== fb[k]) linhas.push(`~ ${k}: ${fa[k] ?? "(vazio)"} → ${fb[k] ?? "(vazio)"}`);
  }
  return linhas;
}
```

Acrescente a `extractor/test/style.test.ts` o teste do rótulo:

```ts
test("a prévia nomeia rótulo trocado", () => {
  const antes = base();
  const depois = aplicar(antes, [{ op: "renomear-campo", alvo: "email", label: "Seu e-mail" }]);
  assert.ok(diferenca(antes, depois).some((l) => l.includes("rótulo de email")));
});
```

- [ ] **Step 5: rodar, typecheck e commit**

```bash
cd extractor && npm test && npx tsc --noEmit
git add extractor/src/forms/style.ts extractor/src/forms/diff.ts extractor/test/style.test.ts
git commit -m "feat(extractor): tokens em estilo do GHL e prévia de mudança"
```

---

### Task 4: comando `formulario-acao`

**Files:**
- Modify: `extractor/src/cli.ts` (runner novo + registro do comando)
- Modify: `extractor/package.json` (script)

**Interfaces:**
- Consumes: `criar`, `publicar`, `apagar`, `duplicar`, `restaurarVersao`, `baixarVersao` de `api/forms-write.js`; `getForm`, `getSurvey` de `api/forms.js`; `aplicar`, `type Op` de `forms/doc.js`; `diferenca` de `forms/diff.js`; `registroEscrita`, `withClient` de `cli.ts`.
- Produces: o comando `formulario-acao` e o JSON `{aplicado, acao, resposta, registro}` (ou `{previa: string[]}` sem `--confirmo`).

- [ ] **Step 1: escrever o runner**

Em `extractor/src/cli.ts`, ao lado de `runFormularios`:

```ts
const FORM_ACOES = [
  "criar", "apagar", "duplicar", "editar", "versoes", "restaurar",
];

/** O documento vivo de um formulário ou survey, mais o nome atual. */
async function carregarDoc(
  client: GhlClient, tipo: "formulario" | "survey", loc: string, id: string,
): Promise<{ nome: string; doc: Record<string, unknown>; raw: any }> {
  const raw: any = tipo === "survey"
    ? await getSurvey(client, loc, id)
    : await getForm(client, id);
  const obj = raw.form ?? raw.survey ?? raw;
  const doc = obj.formData ?? obj.surveyData;
  if (!doc) throw new Error(`o servidor não devolveu formData para ${id}`);
  return { nome: obj.name ?? "", doc, raw };
}

async function runFormularioAcao(opts: {
  location: string; acao: string; tipo?: string; id?: string; nome?: string;
  ops?: string; versao?: string; pasta?: string;
  permitirSemBotao?: boolean; permitirVazio?: boolean;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!FORM_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${FORM_ACOES.join(", ")}`);
  }
  const tipo = (opts.tipo ?? "formulario") as "formulario" | "survey";
  if (tipo !== "formulario" && tipo !== "survey") {
    throw new Error("--tipo aceita formulario ou survey");
  }
  if (opts.acao !== "criar" && !opts.id) throw new Error(`${opts.acao} exige --id`);
  if (opts.acao === "criar" && !opts.nome) throw new Error("criar exige --nome");
  if (opts.acao === "restaurar" && !opts.versao) throw new Error("restaurar exige --versao");

  let ops: Op[] = [];
  if (opts.ops) {
    try {
      ops = JSON.parse(opts.ops);
    } catch {
      throw new Error('--ops precisa ser JSON: [{"op":"adicionar-campo","campo":{...}}]');
    }
    if (!Array.isArray(ops)) throw new Error("--ops precisa ser uma lista JSON");
  }
  if (opts.acao === "editar" && ops.length === 0) {
    throw new Error("editar exige --ops com ao menos uma operação");
  }

  await withClient(opts.location, log, async (client) => {
    // `versoes` é leitura: sai antes de qualquer guarda de escrita
    if (opts.acao === "versoes") {
      const { raw } = await carregarDoc(client, tipo, opts.location, opts.id!);
      const obj = raw.form ?? raw.survey ?? raw;
      const versoes = (obj.versionHistory ?? []).map((v: any) => ({
        versionId: v.versionId, em: v.updatedAt, por: v.updatedByUser,
        documento: v.formDataDownloadUrl ?? v.surveyDataDownloadUrl,
      }));
      if (opts.json) console.log(JSON.stringify({ versoes }));
      else versoes.forEach((v: any) => log(`${v.em}  ${v.versionId}  ${v.por ?? ""}`));
      return;
    }

    // prévia: monta o documento novo e mostra a diferença, sem tocar no servidor
    if (opts.acao === "editar" && !opts.confirmo) {
      const { doc } = await carregarDoc(client, tipo, opts.location, opts.id!);
      const novo = aplicar(doc, ops, {
        permitirSemBotao: opts.permitirSemBotao, permitirVazio: opts.permitirVazio,
      });
      const previa = diferenca(doc, novo);
      if (opts.json) console.log(JSON.stringify({ aplicado: false, previa }));
      else {
        log(previa.length ? previa.join("\n") : "nada mudaria");
        log("\nnada foi gravado. Repita com --confirmo para publicar.");
      }
      return;
    }

    if (!opts.confirmo) {
      throw new Error("Isto muda dado real da subconta e não tem desfazer. Repita com --confirmo.");
    }

    const antes = opts.acao === "criar"
      ? null
      : await carregarDoc(client, tipo, opts.location, opts.id!).catch(() => null);
    const registro = registroEscrita(opts.location, "_formularios", opts.id ?? "novo", {
      acao: opts.acao, tipo, ops, antes, aplicado: false,
    });
    log(`snapshot: ${registro}`);

    let r: unknown;
    try {
      switch (opts.acao) {
        case "criar": {
          const criado: any = await criar(client, tipo, {
            locationId: opts.location,
            productType: tipo === "survey" ? "Survey" : "Form",
            parentId: opts.pasta,
          });
          const novoId = criado?.form?._id ?? criado?.survey?._id ?? criado?._id;
          if (!novoId) throw new Error(`o servidor não devolveu o id do novo ${tipo}`);
          // o objeto nasce vazio e sem nome; publicar de novo grava nome e campos
          const { doc } = await carregarDoc(client, tipo, opts.location, novoId);
          const corpo = ops.length
            ? aplicar(doc, ops, { permitirSemBotao: true, permitirVazio: true })
            : doc;
          r = { criado, publicado: await publicar(client, tipo, novoId, opts.nome!, corpo), id: novoId };
          break;
        }
        case "editar": {
          const novo = aplicar(antes!.doc, ops, {
            permitirSemBotao: opts.permitirSemBotao, permitirVazio: opts.permitirVazio,
          });
          r = await publicar(client, tipo, opts.id!, opts.nome ?? antes!.nome, novo);
          break;
        }
        case "apagar": r = await apagar(client, tipo, opts.id!); break;
        case "duplicar": r = await duplicar(client, tipo, opts.id!, opts.nome ?? "cópia", opts.pasta); break;
        case "restaurar": r = await restaurarVersao(client, tipo, opts.id!, opts.versao!); break;
      }
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: opts.acao, tipo, ops, antes, aplicado: false, erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: opts.acao, tipo, ops, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: opts.acao, resposta: r, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — ${opts.acao}; registro em ${registro}`);
  });
}
```

Acrescente os imports no topo de `cli.ts`: `criar`, `publicar`, `apagar`, `duplicar`, `restaurarVersao`, `baixarVersao` de `./api/forms-write.js`; `aplicar`, `type Op` de `./forms/doc.js`; `diferenca` de `./forms/diff.js`.

- [ ] **Step 2: registrar o comando**

No fim de `extractor/src/cli.ts`, depois do bloco `formularios`:

```ts
program
  .command("formulario-acao")
  .description("ESCREVE: cria, edita, duplica, apaga ou restaura formulário e survey")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", FORM_ACOES.join(" | "))
  .option("--tipo <t>", "formulario | survey", "formulario")
  .option("-i, --id <id>", "id do formulário ou survey")
  .option("--nome <texto>", "nome do formulário (criar, duplicar, editar)")
  .option("--ops <json>", 'operações: [{"op":"remover-campo","alvo":"email"}]')
  .option("--versao <versionId>", "versão a restaurar")
  .option("--pasta <id>", "pasta de destino (survey)")
  .option("--permitir-sem-botao", "libera deixar o documento sem botão de envio")
  .option("--permitir-vazio", "libera deixar o documento sem nenhum campo")
  .option("--confirmo", "obrigatório: publica de verdade. Sem ele, só mostra a prévia")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runFormularioAcao(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

E em `extractor/package.json`, nos scripts: `"formulario-acao": "tsx src/cli.ts formulario-acao",`.

- [ ] **Step 3: typecheck**

Run: `cd extractor && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: exercitar a prévia contra um formulário real, sem escrever**

```bash
cd extractor
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao versoes -i JAzIxEXTxIOeuQd5FvYE --json
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i JAzIxEXTxIOeuQd5FvYE \
  --ops '[{"op":"renomear-campo","alvo":"email","label":"Seu melhor e-mail"}]'
```

Expected: a segunda imprime uma linha de rótulo trocado e "nada foi gravado". Nenhum arquivo em `_formularios/`, porque a prévia não grava rastro.

- [ ] **Step 5: commit**

```bash
git add extractor/src/cli.ts extractor/package.json
git commit -m "feat(extractor): comando formulario-acao com prévia e guardas"
```

---

### Task 5: comando `formulario-estilo`

**Files:**
- Modify: `extractor/src/cli.ts`
- Modify: `extractor/package.json`

**Interfaces:**
- Consumes: `opsDeEstilo`, `paletaDeTokens`, `type Tokens` de `forms/style.js`; `paletaPadrao`, `gravarPaletaPadrao`, `temas`, `tema`, `publicar` de `api/forms-write.js`; `carregarDoc`, `aplicar`, `diferenca`.
- Produces: o comando `formulario-estilo`.

- [ ] **Step 1: escrever o runner**

```ts
const ESTILO_ACOES = ["aplicar", "paleta-ver", "paleta-gravar", "temas"];

async function runFormularioEstilo(opts: {
  location: string; acao: string; tipo?: string; id?: string; tokens?: string;
  confirmo?: boolean; json?: boolean;
}): Promise<void> {
  const log = opts.json ? console.error : console.log;
  if (!ESTILO_ACOES.includes(opts.acao)) {
    throw new Error(`--acao inválida: ${opts.acao}. Aceitas: ${ESTILO_ACOES.join(", ")}`);
  }
  const tipo = (opts.tipo ?? "formulario") as "formulario" | "survey";

  let tokens: Tokens | undefined;
  if (opts.tokens) {
    const texto = fs.existsSync(opts.tokens) ? fs.readFileSync(opts.tokens, "utf-8") : opts.tokens;
    try {
      tokens = JSON.parse(texto);
    } catch {
      throw new Error("--tokens precisa ser JSON, ou o caminho de um arquivo JSON");
    }
  }
  if ((opts.acao === "aplicar" || opts.acao === "paleta-gravar") && !tokens) {
    throw new Error(`${opts.acao} exige --tokens`);
  }
  if (opts.acao === "aplicar" && !opts.id) throw new Error("aplicar exige --id");

  await withClient(opts.location, log, async (client) => {
    if (opts.acao === "temas" || opts.acao === "paleta-ver") {
      const r = opts.acao === "temas"
        ? await temas(client, tipo, opts.location)
        : await paletaPadrao(client, opts.location);
      if (opts.json) console.log(JSON.stringify({ resultado: r }));
      else log(JSON.stringify(r, null, 2));
      return;
    }

    if (opts.acao === "aplicar") {
      const { nome, doc } = await carregarDoc(client, tipo, opts.location, opts.id!);
      const novo = aplicar(doc, opsDeEstilo(doc, tokens!));
      if (!opts.confirmo) {
        const previa = diferenca(doc, novo);
        if (opts.json) console.log(JSON.stringify({ aplicado: false, previa }));
        else { log(previa.join("\n")); log("\nnada foi gravado. Repita com --confirmo."); }
        return;
      }
      const registro = registroEscrita(opts.location, "_formularios", opts.id!, {
        acao: "estilo", tipo, tokens, antes: doc, aplicado: false,
      });
      log(`snapshot: ${registro}`);
      let r: unknown;
      try {
        r = await publicar(client, tipo, opts.id!, nome, novo);
      } catch (e) {
        fs.writeFileSync(registro, JSON.stringify({
          em: new Date().toISOString(), acao: "estilo", tipo, tokens, antes: doc, aplicado: false, erro: String(e),
        }, null, 2));
        throw e;
      }
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: "estilo", tipo, tokens, antes: doc, aplicado: true, resposta: r,
      }, null, 2));
      const out = { aplicado: true, acao: "estilo", resposta: r, registro };
      if (opts.json) console.log(JSON.stringify(out));
      else log(`ok — estilo aplicado; registro em ${registro}`);
      return;
    }

    // paleta-gravar: muda TODA a subconta, não um formulário
    if (!opts.confirmo) {
      throw new Error(
        "gravar a paleta muda a cor padrão de todo formulário novo desta subconta, " +
        "inclusive os que o cliente criar na interface. Repita com --confirmo.",
      );
    }
    const antes = await paletaPadrao(client, opts.location).catch(() => null);
    const registro = registroEscrita(opts.location, "_formularios", "paleta", {
      acao: "paleta-gravar", tokens, antes, aplicado: false,
    });
    log(`snapshot: ${registro}`);
    let r: unknown;
    try {
      r = await gravarPaletaPadrao(client, opts.location, paletaDeTokens(tokens!));
    } catch (e) {
      fs.writeFileSync(registro, JSON.stringify({
        em: new Date().toISOString(), acao: "paleta-gravar", tokens, antes, aplicado: false, erro: String(e),
      }, null, 2));
      throw e;
    }
    fs.writeFileSync(registro, JSON.stringify({
      em: new Date().toISOString(), acao: "paleta-gravar", tokens, antes, aplicado: true, resposta: r,
    }, null, 2));
    const out = { aplicado: true, acao: "paleta-gravar", resposta: r, registro };
    if (opts.json) console.log(JSON.stringify(out));
    else log(`ok — paleta gravada; registro em ${registro}`);
  });
}
```

- [ ] **Step 2: registrar o comando**

```ts
program
  .command("formulario-estilo")
  .description("ESCREVE: aplica tokens visuais a um formulário, ou grava a paleta padrão da subconta")
  .requiredOption("-l, --location <id>", "locationId da subconta")
  .requiredOption("--acao <a>", ESTILO_ACOES.join(" | "))
  .option("--tipo <t>", "formulario | survey", "formulario")
  .option("-i, --id <id>", "id do formulário ou survey")
  .option("--tokens <json|arquivo>", "tokens de identidade visual")
  .option("--confirmo", "obrigatório para gravar. Sem ele, só mostra a prévia")
  .option("--json", "imprime o resultado em JSON no stdout")
  .action((o) => runFormularioEstilo(o).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }));
```

E o script `"formulario-estilo": "tsx src/cli.ts formulario-estilo",` em `package.json`.

- [ ] **Step 3: conferir as chaves reais da paleta**

```bash
cd extractor
npm run formulario-estilo -- -l Xb9gDxwxYhdqtprGcb5E --acao paleta-ver --json | jq .
npm run formulario-estilo -- -l Xb9gDxwxYhdqtprGcb5E --acao temas --json | jq '.resultado | keys'
```

Expected: a paleta vem com as chaves reais do servidor. Ajuste `paletaDeTokens` em `extractor/src/forms/style.ts` e o teste correspondente se divergirem da hipótese.

- [ ] **Step 4: typecheck, teste e commit**

```bash
cd extractor && npx tsc --noEmit && npm test
git add extractor/src/cli.ts extractor/src/forms/style.ts extractor/test/style.test.ts extractor/package.json
git commit -m "feat(extractor): comando formulario-estilo e paleta da subconta"
```

---

### Task 6: screenshot da página pública

**Files:**
- Modify: `extractor/src/cli.ts` (ação `previa-visual` no comando `formulario-estilo`)

**Interfaces:**
- Consumes: a `page` do `withClient` (`extractor/src/cli.ts:87-107`).
- Produces: ação `previa-visual`, que grava um PNG e imprime o caminho.

- [ ] **Step 1: acrescentar a ação**

Some `"previa-visual"` a `ESTILO_ACOES` e o ramo, dentro do `withClient` (que já expõe `page` como segundo parâmetro — troque a assinatura do callback para `async (client, page) => {`):

```ts
    if (opts.acao === "previa-visual") {
      if (!opts.id) throw new Error("previa-visual exige --id");
      const widget = tipo === "survey" ? "survey" : "form";
      const versao = opts.versao ? `&versionId=${encodeURIComponent(opts.versao)}&nocache=true` : "";
      // `notrack=true`: o preview não conta como visita na estatística do cliente
      const url = `https://link.msgsndr.com/widget/${widget}/${encodeURIComponent(opts.id)}?notrack=true${versao}`;
      const destino = opts.saida ?? path.join(os.tmpdir(), `formulario-${opts.id}.png`);
      const aba = await page.context().newPage();
      try {
        await aba.setViewportSize({ width: 480, height: 900 });
        await aba.goto(url, { waitUntil: "networkidle" });
        await aba.screenshot({ path: destino, fullPage: true });
      } finally {
        await aba.close();
      }
      if (opts.json) console.log(JSON.stringify({ url, arquivo: destino }));
      else log(`${url}\n${destino}`);
      return;
    }
```

Acrescente as opções `--versao <versionId>` e `--saida <arquivo>` ao comando `formulario-estilo`, e os campos correspondentes ao tipo de `opts`.

- [ ] **Step 2: exercitar contra um formulário real**

```bash
cd extractor
npm run formulario-estilo -- -l Xb9gDxwxYhdqtprGcb5E --acao previa-visual -i JAzIxEXTxIOeuQd5FvYE --saida /tmp/f.png
```

Expected: o PNG existe e mostra o formulário. Abra e confira: `open /tmp/f.png`.

- [ ] **Step 3: typecheck e commit**

```bash
cd extractor && npx tsc --noEmit
git add extractor/src/cli.ts
git commit -m "feat(extractor): screenshot da página pública do formulário"
```

---

### Task 7: tools MCP

**Files:**
- Modify: `auditor/src/automaster_audit/mcp_server.py`
- Create: `auditor/tests/test_mcp_formularios_escrita.py`

**Interfaces:**
- Consumes: `_run_extractor`, `_load`, `ToolError` de `mcp_server.py`.
- Produces: `formulario_acao(...)` e `formulario_estilo(...)` no dict `TOOLS`.

- [ ] **Step 1: escrever os testes que falham**

Crie `auditor/tests/test_mcp_formularios_escrita.py`, no molde de `auditor/tests/test_mcp_tools.py:239-254`:

```python
import pytest
from automaster_audit import mcp_server as srv


@pytest.fixture
def espiao(monkeypatch):
    chamadas = []

    def falso(*args):
        chamadas.append(args)
        return {"aplicado": True}

    monkeypatch.setattr(srv, "_run_extractor", falso)
    monkeypatch.setattr(srv, "_load", lambda loc, snap=None: (None, {"loc": loc}))
    return chamadas


def test_acao_exige_confirmo(espiao):
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.formulario_acao(loc="L1", acao="editar", id="F1",
                            ops=[{"op": "remover-campo", "alvo": "email"}])
    assert espiao == []


def test_previa_nao_exige_confirmo(espiao):
    srv.formulario_acao(loc="L1", acao="previa", id="F1",
                        ops=[{"op": "remover-campo", "alvo": "email"}])
    args = espiao[0]
    assert "--confirmo" not in args
    assert args[:5] == ("formulario-acao", "-l", "L1", "--acao", "editar")


def test_acao_invalida(espiao):
    with pytest.raises(srv.ToolError, match="acao inválida"):
        srv.formulario_acao(loc="L1", acao="voar", id="F1", confirmo=True)


def test_editar_sem_ops(espiao):
    with pytest.raises(srv.ToolError, match="ops"):
        srv.formulario_acao(loc="L1", acao="editar", id="F1", confirmo=True)


def test_ops_viram_json_no_argumento(espiao):
    srv.formulario_acao(loc="L1", acao="editar", id="F1", confirmo=True,
                        ops=[{"op": "remover-campo", "alvo": "email"}])
    args = espiao[0]
    assert "--confirmo" in args
    assert '"remover-campo"' in args[args.index("--ops") + 1]


def test_estilo_exige_tokens(espiao):
    with pytest.raises(srv.ToolError, match="tokens"):
        srv.formulario_estilo(loc="L1", acao="aplicar", id="F1", confirmo=True)


def test_paleta_gravar_exige_confirmo(espiao):
    with pytest.raises(srv.ToolError, match="confirmo=true"):
        srv.formulario_estilo(loc="L1", acao="paleta-gravar", tokens={"corPrimaria": "#000000"})


def test_as_duas_tools_estao_declaradas():
    assert "formulario_acao" in srv.TOOLS
    assert "formulario_estilo" in srv.TOOLS
    for nome in ("formulario_acao", "formulario_estilo"):
        func, desc, props, req = srv.TOOLS[nome]
        assert "loc" in req and "acao" in req
        assert "ESCREVE" in desc
```

- [ ] **Step 2: rodar para ver falhar**

Run: `cd auditor && .venv/bin/python -m pytest tests/test_mcp_formularios_escrita.py -q`
Expected: FAIL — `AttributeError: module has no attribute 'formulario_acao'`.

- [ ] **Step 3: implementar as tools**

Em `auditor/src/automaster_audit/mcp_server.py`, perto de `formularios` (`:551`):

```python
FORM_ACOES = ("criar", "apagar", "duplicar", "editar", "previa", "versoes", "restaurar")
ESTILO_ACOES = ("aplicar", "previa", "previa-visual", "paleta-ver", "paleta-gravar", "temas")


def formulario_acao(loc: str, acao: str, tipo: str = "formulario", id: str | None = None,
                    nome: str | None = None, ops: list | None = None,
                    versao: str | None = None, pasta: str | None = None,
                    permitir_sem_botao: bool = False, permitir_vazio: bool = False,
                    confirmo: bool = False, snapshot: str | None = None) -> dict:
    """ESCREVE: cria, edita, duplica, apaga ou restaura formulário e survey."""
    if acao not in FORM_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(FORM_ACOES)}")
    if tipo not in FORM_TIPOS:
        raise ToolError(f"tipo inválido: {tipo}. Aceitos: {', '.join(FORM_TIPOS)}")
    if acao != "criar" and not id:
        raise ToolError(f"{acao} exige o id do formulário ou survey")
    if acao == "criar" and not nome:
        raise ToolError("criar exige nome")
    if acao == "restaurar" and not versao:
        raise ToolError("restaurar exige versao")
    if acao in ("editar", "previa") and not ops:
        raise ToolError("editar e previa exigem ops: [{'op': ..., ...}]")
    # `previa` e `versoes` não escrevem nada
    escreve = acao not in ("previa", "versoes")
    if escreve and not confirmo:
        raise ToolError("Isto muda dado real da subconta e não tem desfazer. "
                        "Repita com confirmo=true, ou use acao='previa' para ver o que mudaria.")
    _, meta = _load(loc, snapshot)
    args = ["formulario-acao", "-l", loc,
            "--acao", "editar" if acao == "previa" else acao, "--tipo", tipo]
    if escreve:
        args.append("--confirmo")
    for flag, val in (("-i", id), ("--nome", nome), ("--versao", versao), ("--pasta", pasta)):
        if val:
            args += [flag, val]
    if ops:
        args += ["--ops", json.dumps(ops)]
    if permitir_sem_botao:
        args.append("--permitir-sem-botao")
    if permitir_vazio:
        args.append("--permitir-vazio")
    return _run_extractor(*args, "--json") | {"_snapshot": meta}


def formulario_estilo(loc: str, acao: str, tipo: str = "formulario", id: str | None = None,
                      tokens: dict | None = None, versao: str | None = None,
                      saida: str | None = None, confirmo: bool = False,
                      snapshot: str | None = None) -> dict:
    """ESCREVE: aplica tokens visuais a um formulário, ou grava a paleta da subconta."""
    if acao not in ESTILO_ACOES:
        raise ToolError(f"acao inválida: {acao}. Aceitas: {', '.join(ESTILO_ACOES)}")
    if acao in ("aplicar", "previa", "previa-visual") and not id:
        raise ToolError(f"{acao} exige o id do formulário ou survey")
    if acao in ("aplicar", "previa", "paleta-gravar") and not tokens:
        raise ToolError(f"{acao} exige tokens")
    escreve = acao in ("aplicar", "paleta-gravar")
    if escreve and not confirmo:
        raise ToolError(
            "Isto muda dado real da subconta e não tem desfazer. Repita com confirmo=true, "
            "ou use acao='previa' para ver o que mudaria."
            if acao == "aplicar" else
            "Gravar a paleta muda a cor padrão de todo formulário novo desta subconta, "
            "inclusive os que o cliente criar na interface. Repita com confirmo=true.")
    _, meta = _load(loc, snapshot)
    args = ["formulario-estilo", "-l", loc,
            "--acao", "aplicar" if acao == "previa" else acao, "--tipo", tipo]
    if escreve:
        args.append("--confirmo")
    for flag, val in (("-i", id), ("--versao", versao), ("--saida", saida)):
        if val:
            args += [flag, val]
    if tokens:
        args += ["--tokens", json.dumps(tokens)]
    return _run_extractor(*args, "--json") | {"_snapshot": meta}
```

E as entradas no dict `TOOLS`:

```python
    "formulario_acao": (formulario_acao,
                        "ESCREVE EM PRODUÇÃO: cria, edita, duplica, apaga ou restaura um "
                        "formulário ou survey. A edição REPUBLICA O DOCUMENTO INTEIRO a partir "
                        "do que está no servidor, aplicando as `ops` declaradas — nunca peça "
                        "JSON cru do formulário. Use acao='previa' primeiro: ela mostra campo "
                        "que entra, campo que sai e estilo alterado sem gravar nada. "
                        "acao='versoes' lista o histórico e 'restaurar' volta a uma versão. "
                        "Remover exige nomear o campo; deixar o documento sem botão de envio ou "
                        "sem campo nenhum é recusado (permitir_sem_botao / permitir_vazio). "
                        "Slide só existe em survey. Exige confirmo=true; registro em "
                        "<dumps>/_formularios/.",
                        {"loc": _LOC, "acao": {"type": "string", "enum": list(FORM_ACOES)},
                         "tipo": {"type": "string", "enum": list(FORM_TIPOS), "default": "formulario"},
                         "id": {"type": "string"}, "nome": {"type": "string"},
                         "ops": {"type": "array", "items": {"type": "object"},
                                 "description": "operações: adicionar-campo, remover-campo, "
                                                "renomear-campo, reordenar-campos, mover-campo, "
                                                "criar-slide, remover-slide, renomear-slide, "
                                                "reordenar-slides, definir-logica, definir"},
                         "versao": {"type": "string", "description": "versionId (restaurar)"},
                         "pasta": {"type": "string"},
                         "permitir_sem_botao": {"type": "boolean", "default": False},
                         "permitir_vazio": {"type": "boolean", "default": False},
                         "confirmo": {"type": "boolean", "default": False},
                         "snapshot": _SNAP},
                        ["loc", "acao"]),
    "formulario_estilo": (formulario_estilo,
                          "ESCREVE EM PRODUÇÃO: aplica a identidade visual a um formulário ou "
                          "survey (acao='aplicar'), mostra a prévia ('previa'), tira screenshot "
                          "da página pública real ('previa-visual'), lê os temas e a paleta da "
                          "subconta ('temas', 'paleta-ver') ou grava a paleta padrão "
                          "('paleta-gravar' — muda a cor de TODO formulário novo da subconta). "
                          "Os tokens saem da skill automaster-formulario-visual. O estilo vai "
                          "para fieldStyle e customStyle; fieldCSS NUNCA é escrito, porque o "
                          "builder o regenera e apagaria o trabalho. Exige confirmo=true para "
                          "gravar; registro em <dumps>/_formularios/.",
                          {"loc": _LOC, "acao": {"type": "string", "enum": list(ESTILO_ACOES)},
                           "tipo": {"type": "string", "enum": list(FORM_TIPOS), "default": "formulario"},
                           "id": {"type": "string"},
                           "tokens": {"type": "object",
                                      "description": "corPrimaria, corTexto, corFundo, corBorda, "
                                                     "corErro, fonte, tamanhoRotulo, pesoRotulo, "
                                                     "radius, espacamento, cssLivre"},
                           "versao": {"type": "string"}, "saida": {"type": "string"},
                           "confirmo": {"type": "boolean", "default": False},
                           "snapshot": _SNAP},
                          ["loc", "acao"]),
```

Acrescente também o ramo de dica no timeout e na falha de `_run_extractor` (`:252-262`): quando `args[0]` começar com `formulario-`, a dica é "confira o estado atual com a tool `formularios`, o=detalhe".

- [ ] **Step 4: rodar os testes**

Run: `cd auditor && .venv/bin/python -m pytest -q`
Expected: PASS, contagem sobe de 222 para 230.

- [ ] **Step 5: commit**

```bash
git add auditor/src/automaster_audit/mcp_server.py auditor/tests/test_mcp_formularios_escrita.py
git commit -m "feat(mcp): tools formulario_acao e formulario_estilo"
```

---

### Task 8: skill `automaster-formulario-visual`

**Files:**
- Create: `skills/automaster-formulario-visual/SKILL.md`

- [ ] **Step 1: escrever a skill**

```markdown
---
name: automaster-formulario-visual
description: Define a identidade visual de um formulário ou survey do GoHighLevel a partir da marca do cliente, produzindo os tokens que a tool `formulario_estilo` aplica. Use ao criar um formulário sob medida, ao redesenhar um existente, ou quando o pedido envolver a aparência de um formulário do GHL.
---

# Identidade visual de formulário do GHL

Produz um conjunto de tokens. Não escreve no formulário: quem escreve é a tool
`formulario_estilo`.

## O que o GHL aceita

Dois destinos, com papéis diferentes:

- **`fieldStyle`** — o painel de estilo do builder. Cor de fundo, cor de texto, cor e
  fonte do rótulo, borda, radius, espaçamento. Sobrevive a qualquer edição que o cliente
  faça na interface. É o destino preferido: tudo que couber aqui vai aqui.
- **`customStyle`** — CSS livre, para o que o painel não modela. Seletores conhecidos:
  `.hl-error`, `.error-message`, `.hl-progress .fill`, `.ghl-footer-preview .ghl-submit-btn`,
  `.ghl-footer-preview .ghl-footer-next`, `.ghl-footer-preview .ghl-footer-back`.

**Nunca escreva em `fieldCSS` nem em `mobileFieldCSS`.** O builder os regenera a partir do
`fieldStyle` e apaga o que estiver ali.

CSS do site que embute o formulário não entra: ele roda em iframe. Todo estilo tem que
estar no documento.

## Passos

1. **Leia o que já existe.** `formulario_estilo` com `acao="paleta-ver"` e `acao="temas"`.
   Se a subconta já tem cor definida, ela é o ponto de partida — o formulário novo tem que
   conversar com os que o cliente já usa, não competir com eles.
2. **Decida a estética.** Invoque a skill `impeccable` só para isto: a direção visual a
   partir da marca do cliente. Não peça a ela o documento do formulário nem CSS pronto.
3. **Traduza em tokens.** O formato:

```json
{
  "corPrimaria": "#0f62fe",
  "corTexto": "#161616",
  "corFundo": "#ffffff",
  "corBorda": "#8d8d8d",
  "corErro": "#da1e28",
  "fonte": "IBM Plex Sans",
  "tamanhoRotulo": 14,
  "pesoRotulo": 600,
  "radius": 4,
  "espacamento": 16,
  "cssLivre": ""
}
```

4. **Veja antes de gravar.** `formulario_estilo` com `acao="previa"`, depois
   `acao="aplicar"` com `confirmo=true` num formulário descartável, depois
   `acao="previa-visual"`, que fotografa a página pública real. Itere ali.
5. **Só então** aplique no formulário de produção.

## Piso, não opinião

Formulário é a porta de entrada do lead. Independentemente da estética escolhida:

- Contraste de texto e de rótulo em AA (4,5:1 para texto normal).
- Foco de teclado visível — nunca `outline: none` sem substituto.
- Alvo de toque de pelo menos 44px de altura no botão e nos campos.
- Erro legível sem depender de cor: o texto do erro diz o que fazer.
- No survey, a navegação entre slides recebe o mesmo cuidado dos campos. Survey bonito nos
  campos e cru no rodapé não está pronto.
```

- [ ] **Step 2: verificar que o plugin carrega a skill**

Run: `ls skills/` e confira que a nova pasta está ao lado de `automaster-leitura/`, com o mesmo formato de frontmatter.

- [ ] **Step 3: commit**

```bash
git add skills/automaster-formulario-visual/SKILL.md
git commit -m "feat(plugin): skill de identidade visual de formulário"
```

---

### Task 9: validação ao vivo, do zero ao apagar

**Files:**
- Modify: `docs/endpoints.md`
- Create: nenhum arquivo de código

Esta tarefa é a prova. Nada aqui é opcional, e cada resultado inesperado volta como correção nas tarefas anteriores.

- [ ] **Step 1: conferir os gatilhos sem filtro antes de criar nada**

```bash
cd auditor
.venv/bin/python - <<'PY'
import json, pathlib, os
raiz = pathlib.Path(os.path.expanduser("~/.automaster/dumps/Xb9gDxwxYhdqtprGcb5E"))
snap = sorted(p for p in raiz.iterdir() if (p / "manifest.json").exists())[-1]
wfs = json.loads((snap / "workflows.json").read_text())["raw"]
for w in wfs:
    for t in (w.get("triggers") or []):
        if "form" in json.dumps(t).lower() and "submit" in json.dumps(t).lower():
            print(w.get("name"), "|", json.dumps(t.get("filters") or t, ensure_ascii=False)[:160])
PY
```

Expected: a lista dos workflows que reagem a envio de formulário. Os que não nomeiam um formulário específico reagiriam ao formulário de teste. Anote quais são; o formulário de teste não vai receber submissão nenhuma, então eles não disparam — mas saber quais são é o que permite afirmar isso.

- [ ] **Step 2: criar o formulário descartável**

```bash
cd extractor
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao criar --nome "ZZ TESTE AUTOMASTER" --confirmo --json | tee /tmp/criado.json
ID=$(jq -r '.resposta.id' /tmp/criado.json)
```

Expected: `aplicado:true` e um id. Guarde o id.

- [ ] **Step 3: exercitar todas as operações de campo**

Rode, uma a uma, conferindo a prévia antes de cada `--confirmo`:

```bash
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i $ID --ops '[
  {"op":"adicionar-campo","campo":{"tag":"full_name","label":"Nome","type":"text","standard":true,"required":true}},
  {"op":"adicionar-campo","campo":{"tag":"email","label":"E-mail","type":"email","standard":true,"required":true}},
  {"op":"adicionar-campo","campo":{"tag":"button","label":"Enviar","type":"submit"}}
]' --permitir-sem-botao --confirmo --json
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i $ID --ops '[{"op":"renomear-campo","alvo":"email","label":"Seu melhor e-mail"}]' --confirmo --json
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i $ID --ops '[{"op":"reordenar-campos","ordem":["email","full_name"]}]' --confirmo --json
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao editar -i $ID --ops '[{"op":"remover-campo","alvo":"email"}]' --confirmo --json
```

Depois de cada uma, confira o resultado no servidor:

```bash
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o detalhe -i $ID --json | jq '.form.formData.form.fields | map(.tag)'
```

Expected: o servidor reflete exatamente o que a prévia anunciou. Divergência = bug no motor; corrija a Tarefa 2 e refaça.

- [ ] **Step 4: adicionar um campo de contato de verdade**

Pegue um custom field real da Instaltech no dump (`custom_fields.json`) e adicione-o pelo `--ops`, copiando `id`, `tag`, `fieldKey`, `dataType`, `model`, `name` e `picklistOptions` do próprio dump. Confira na página pública que ele aparece e aceita valor.

- [ ] **Step 5: repetir tudo num survey, com slides**

```bash
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao criar --tipo survey --nome "ZZ TESTE AUTOMASTER SURVEY" --confirmo --json
```

Exercite: `criar-slide` três vezes, `renomear-slide`, `reordenar-slides`, `adicionar-campo` com `slide`, `mover-campo` entre slides, `remover-slide`, e a lógica condicional da Tarefa 2b. Confira cada uma na página pública, navegando entre as telas.

- [ ] **Step 6: estilo, prévia visual e paleta**

```bash
cat > /tmp/tokens.json <<'JSON'
{"corPrimaria":"#0f62fe","corTexto":"#161616","corFundo":"#ffffff","corBorda":"#8d8d8d",
 "corErro":"#da1e28","fonte":"IBM Plex Sans","tamanhoRotulo":14,"pesoRotulo":600,
 "radius":4,"espacamento":16,"cssLivre":".hl-error{font-weight:600}"}
JSON
npm run formulario-estilo -- -l Xb9gDxwxYhdqtprGcb5E --acao aplicar -i $ID --tokens /tmp/tokens.json --confirmo --json
npm run formulario-estilo -- -l Xb9gDxwxYhdqtprGcb5E --acao previa-visual -i $ID --saida /tmp/depois.png
```

Expected: a foto mostra o formulário com as cores e a fonte dos tokens.

- [ ] **Step 7: responder as três perguntas sem fonte pública**

Com o formulário de teste ainda de pé:

1. Abra-o no builder do GHL pela interface, mexa em qualquer coisa e salve. Baixe o documento de novo e confira se `customStyle` continua lá e se `fieldStyle` sobreviveu. **Anote o resultado em `docs/endpoints.md`** — é a resposta que ninguém tem publicamente.
2. Aplique um `cssLivre` grande (uns 100 KB) e veja se o servidor aceita. Anote o limite, se houver.
3. Envie uma submissão de teste pela página pública, depois remova o campo respondido e confira em `-o submissoes` se a resposta histórica continua visível.

- [ ] **Step 8: histórico e restauração**

```bash
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao versoes -i $ID --json | jq '.versoes | length'
VER=$(npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao versoes -i $ID --json | jq -r '.versoes[2].versionId')
npm run formulario-estilo -- -l Xb9gDxwxYhdqtprGcb5E --acao previa-visual -i $ID --versao $VER --saida /tmp/antiga.png
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao restaurar -i $ID --versao $VER --confirmo --json
```

Expected: o documento volta ao estado daquela versão.

- [ ] **Step 9: duplicar e apagar, sem resíduo**

```bash
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao duplicar -i $ID --nome "ZZ TESTE COPIA" --confirmo --json
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar -i <id da cópia> --confirmo --json
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar -i $ID --confirmo --json
npm run formulario-acao -- -l Xb9gDxwxYhdqtprGcb5E --acao apagar --tipo survey -i <id do survey> --confirmo --json
npm run formularios -- -l Xb9gDxwxYhdqtprGcb5E -o lista --json | jq '.forms | map(.name) | map(select(startswith("ZZ TESTE")))'
```

Expected: lista vazia. Se o `DELETE` for só marcação e o objeto continuar aparecendo, anote isso em `docs/endpoints.md` e apague pela interface.

- [ ] **Step 10: documentar as rotas e commitar**

Acrescente a `docs/endpoints.md`, na seção `## Formulários e surveys`, uma subseção `### Escrita` com a tabela de rotas (método, path, corpo), o host `services.`, a URL pública do widget, o resultado da comparação de hosts da Tarefa 1, e as respostas do passo 7. Marque o que foi exercitado ao vivo e o que não foi.

```bash
git add docs/endpoints.md
git commit -m "docs: rotas de escrita de formulário e survey validadas ao vivo"
```

---

### Task 10: documentação e versão do plugin

**Files:**
- Modify: `.claude-plugin/plugin.json:4`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`
- Modify: `skills/automaster-leitura/SKILL.md`

- [ ] **Step 1: subir a versão**

Em `.claude-plugin/plugin.json`, `"version": "0.12.0"`.

- [ ] **Step 2: entrada no CHANGELOG**

No topo de `CHANGELOG.md`, no formato das entradas existentes:

```markdown
## 0.12.0

Escrita de formulários e surveys. Duas tools novas (`formulario_acao`,
`formulario_estilo`), 27 no total, e a skill `automaster-formulario-visual`.

- Criar, editar, duplicar, apagar e restaurar versão de formulário e survey. A edição
  republica o documento inteiro a partir do que está no servidor, aplicando operações
  declaradas — campo que o automaster não modela atravessa intacto.
- Slide do survey é entidade de primeira classe: criar, remover, renomear, reordenar,
  mover campo entre slides, navegação, barra de progresso e lógica condicional.
- Prévia antes de publicar: sem `--confirmo`, o comando mostra campo que entra, campo que
  sai e estilo alterado, sem tocar no servidor. É o primeiro comando do projeto com esse
  comportamento; os outros continuam dando erro seco.
- Identidade visual por cliente: os tokens vão para `fieldStyle` (o painel do builder, que
  sobrevive a edição na interface) e `customStyle` (CSS livre). `fieldCSS` nunca é escrito.
  Screenshot da página pública real para aprovar antes de aplicar em produção.
- Paleta padrão da subconta: leitura sempre, gravação só por comando à parte.
- Guardas: remover exige nomear o campo; deixar o documento sem botão de envio ou sem
  nenhum campo é recusado sem flag explícita.
- A leitura de formulários migrou de `backend.` para `services.leadconnectorhq.com`, o host
  que o app usa (ou não migrou, se a comparação da Tarefa 1 divergiu — ajuste esta linha
  ao que aconteceu).
```

- [ ] **Step 3: atualizar o CLAUDE.md**

Na seção de arquitetura, acrescente `formulario-acao` e `formulario-estilo` à lista de comandos do extractor, as duas tools novas à lista de tools MCP (passando de vinte e cinco para vinte e sete), a skill nova à lista de `skills/`, e ajuste a seção "Fora de escopo": escrita de formulário e survey sai dela, como saíram oportunidades e escrita de contato.

- [ ] **Step 4: atualizar a skill de leitura**

Em `skills/automaster-leitura/SKILL.md`, acrescente as duas tools novas à lista do frontmatter e uma linha sobre como ler o que elas devolvem — em especial que a prévia (`aplicado:false`) não gravou nada.

- [ ] **Step 5: verificação final e commit**

```bash
cd extractor && npx tsc --noEmit && npm test
cd ../auditor && .venv/bin/python -m pytest -q
cd .. && git add -A && git commit -m "docs: plugin 0.12.0, escrita de formulários e surveys"
```

Expected: typecheck limpo, testes do extractor verdes, 230 testes do auditor verdes.
