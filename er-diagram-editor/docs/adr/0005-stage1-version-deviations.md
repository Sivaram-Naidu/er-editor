# ADR 0005 - Version deviations from SRS S6

**Status:** accepted (confirmed by product owner, Stage 1)

The SRS tech-stack table was written against versions current at authoring time. Actual
installs deviate as follows.

| SRS                    | Installed                                   | Reason                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vite 6                 | Vite 8.2.2                                  | `@vitejs/plugin-react@6` has peer `vite: ^8.0.0`.                                                                                                                                          |
| TypeScript 5.x         | TypeScript 6.0.3                            | Current template default. **Ceiling, not a floor:** `typescript-eslint@8` peer is `>=4.8.4 <6.1.0`, so TS 7 breaks linting entirely. Do not upgrade past 6.0.x without checking that peer. |
| Zod 3 (implied)        | Zod 4.5.4                                   | Recursive schemas via object getters remove the `z.lazy()` + manual annotation dance that `Attribute.children` (composite attributes) would otherwise need.                                |
| `eslint-plugin-import` | `eslint-plugin-import-x`                    | The original's peer stops at ESLint `^9`; we are on ESLint 10. import-x is the maintained fork and provides `no-restricted-paths` for the S8.1 boundary rule.                              |
| -                      | dropped `eslint-import-resolver-typescript` | It pulls `eslint-plugin-import` back in as an optional peer, reintroducing the conflict. Not needed for path-based boundary rules.                                                         |

## Standing constraints agreed with the product owner

- `exactOptionalPropertyTypes: true` stays on. Work around it. Any field that becomes
  genuinely awkward gets flagged individually before tsconfig is relaxed.
- Zod `.default()` vs `.prefault()` choices are documented per field in `schema.ts`
  itself, not only in review conversation.
