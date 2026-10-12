import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The codebase uses the standard async data-loading effect pattern:
      // useEffect(() => void load(), [load]) where load() sets state only
      // after an await. This React Compiler advisory flags the synchronous
      // setState at the top of those loaders as a false positive; the
      // pattern is intentional and correct for fetch-on-mount components.
      "react-hooks/set-state-in-effect": "off",
      // Underscore-prefixed args are intentionally unused (API-shape mocks,
      // placeholder params). Matches the existing `_` naming convention.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated worker bundle (esbuild output) and k6 load scripts run
    // outside the Next/TS app and have their own runtime conventions.
    "dist/**",
    "load/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
