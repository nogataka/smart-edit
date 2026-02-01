import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tsRecommended = tseslint.configs["recommended-type-checked"];
const tsStylistic = tseslint.configs["stylistic-type-checked"];

export default [
  {
    ignores: ["dist/**", "node_modules/**", "src/smart-edit/dashboard-ui/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ...tsRecommended.languageOptions,
      parser: tsParser,
      parserOptions: {
        ...tsRecommended.languageOptions?.parserOptions,
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname
      },
      globals: {
        ...tsRecommended.languageOptions?.globals,
        console: "readonly",
        process: "readonly",
        NodeJS: "readonly",
        Buffer: "readonly",
        BufferEncoding: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      ...tsRecommended.rules,
      ...tsStylistic.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        { accessibility: "no-public" }
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true }
      ],
      "@typescript-eslint/dot-notation": "off"
    }
  },
  prettier
];
