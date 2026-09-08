import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // `/api/logto/sign-out` is a route handler that redirects to Logto's
    // end-session endpoint — it needs a real navigation, so `next/link` would
    // be wrong here. The rule can't tell API routes from pages.
    files: ["src/components/TopNav.tsx", "src/app/no-access/page.tsx"],
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  {
    // eslint-config-next 16.3 turned on the React Compiler rules, which flag
    // the fetch-in-effect pattern these widgets were written with. Demoted to
    // warnings so the lint gate stays meaningful for new code; the widgets
    // want a real data-fetching refactor, tracked separately.
    files: [
      "src/components/dashboard/StatsBar.tsx",
      "src/components/reports/widgets/*.tsx",
    ],
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
