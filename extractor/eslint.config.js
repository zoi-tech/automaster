// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "eslint.config.js"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { project: ["./tsconfig.check.json"], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // As quatro que pegam bug de verdade num CLI todo async: promise solta não
      // espera, e o processo termina antes de a escrita sair.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",

      // O prefixo `_` já é a convenção do código para "existe por simetria/assinatura,
      // não se usa" — é o mesmo que o `tsc` respeita com noUnusedParameters.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_",
      }],

      // Desligada de propósito: os `any` vivem na fronteira com a API interna do GHL,
      // que não é documentada nem modelada — 25 deles só em `src/forms/doc.ts`, que
      // manipula o documento cru do builder. Trocar por `unknown` empurraria o cast
      // para dentro da função sem ganhar segurança nenhuma.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // O runner do node:test já rastreia a promise que `test()` devolve e espera por ela;
    // exigir await em cada chamada só encheria os arquivos de `void`.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      // Os dublês de cliente respondem sem esperar nada, mas precisam ser async
      // para casar a assinatura que estão substituindo.
      "@typescript-eslint/require-await": "off",
    },
  },
);
