import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "media/", "sessions/", "spike/", "draft/", ".superpowers/", ".claude/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
