# Test fixtures

| File                 | What it is                                     | Used by                         |
| -------------------- | ---------------------------------------------- | ------------------------------- |
| `wide-names.sql`     | 3 tables with column names long enough to wrap | `tests/e2e/measurement.spec.ts` |
| `small.erd.json`     | **empty skeleton** — nothing reads it          | nothing                         |
| `reference.erd.json` | **empty skeleton** — nothing reads it          | nothing                         |
| `stress.erd.json`    | **empty skeleton** — nothing reads it          | nothing                         |

## The three `.erd.json` files are empty, and the table above used to say otherwise

It described `reference.erd.json` as "120 entities / 960 attributes / 150 relationships"
used by "all NFR-1.x performance budgets", and `stress.erd.json` as 300 entities. They
contain no entities at all. They are also **invalid** — the schema requires a top-level
`id`, `createdAt` and `updatedAt`, and the skeletons have none, so importing one fails with
_"That file is not a valid diagram: Invalid input: expected string, received undefined at
id"_. Checked in a browser on 10 Sep 2026.

Nothing reads them, so nothing broke. The performance budgets come from `referenceSchema()`
inside `tests/perf/layout.perf.test.ts`, which builds its schema in code.

Left in place rather than deleted or populated, because both are decisions rather than
corrections — see the housekeeping note in `NEXT.md`. But do not trust a fixture table
again without opening the file.

## What a fixture is for here, and what it is not

`referenceSchema()` is 120 entities named `TABLE_0`..`TABLE_119`, each with eight columns
named `field_0`..`field_7`, every one `varchar(255)`. That is a fine guard against an
order-of-magnitude layout regression, and it is worthless for anything about size or shape:
every box measures identically, so nothing about width estimation, wrapping or uneven
degree is exercised. Laying out all 120 in Chrome produces a clean grid with no overlaps.

The same 120 tables with realistic names overlap in 26 places. That is what
`wide-names.sql` is the minimal reproduction of, and why it is a `.sql` file rather than a
generated diagram: the naming is the point, so it has to be readable.

If you add a fixture, say in this table what reads it, and check that something does.
