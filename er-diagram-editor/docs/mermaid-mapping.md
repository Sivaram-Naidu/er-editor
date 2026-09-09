# IR -> Mermaid `erDiagram` mapping

The authoritative, machine-readable version is
`src/io/formats/mermaid/capabilities.ts`. The export dialog's loss report (FR-6.3) is
generated from that declaration by comparing it against what the diagram actually uses,
so an exporter cannot quietly lose something without saying so.

| IR construct                       | Treatment    | Result                                      |
| ---------------------------------- | ------------ | ------------------------------------------- |
| Entity, attribute, data type       | exact        | `ENTITY { type name }`                      |
| Primary key / unique / foreign key | exact        | `PK` / `UK` / `FK` markers                  |
| Comment                            | exact        | quoted suffix                               |
| Cardinality and participation      | exact        | crow's-foot tokens                          |
| Identifying relationship           | exact        | solid `--` vs dotted `..`                   |
| Recursive relationship             | exact        | self-referencing line                       |
| Nullable                           | exact        | noted in the field comment                  |
| **Weak entity**                    | approximated | ordinary entity + header comment            |
| **Multivalued / derived**          | approximated | field kept, flag in its comment             |
| **Composite attribute**            | approximated | flattened to `parent_child` fields          |
| **ISA hierarchy**                  | approximated | plain relationship to the supertype         |
| **N-ary relationship**             | decomposed   | associative entity + N binary relationships |
| **Relationship attributes**        | decomposed   | moved to the associative entity             |
| **Positions**                      | dropped      | Mermaid computes its own layout             |
| **Groups**                         | dropped      | no equivalent                               |

## Sanitisation

Mermaid identifiers allow letters, digits, underscores and hyphens only, and its type
tokens are bare words. So `Order Items (2024)` becomes `Order_Items__2024_` and
`numeric(10,2)` becomes `numeric_10_2_`. Duplicate entity names are suffixed — two blocks
sharing a name silently merge their fields in Mermaid, which would lose data rather than
merely rename it.

`tests/unit/io/mermaid.test.ts` runs the **real mermaid parser** over the output. Substring
assertions would pass happily on a file Mermaid rejects.
