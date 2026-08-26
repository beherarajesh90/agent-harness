import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "graphify-out/**"],
  },
  ...tseslint.configs.recommended,
);
