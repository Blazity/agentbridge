// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.ts"],
  extends: [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@clack/prompts",
            importNames: ["log", "note", "spinner"],
            message: "Use the logger facade from src/utils/logger.ts instead",
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.object.name='console']",
        message: "Use the logger facade from src/utils/logger.ts instead",
      },
    ],
    "@typescript-eslint/consistent-type-definitions": ["warn", "type"],
  },
});
