// WARNING: a foreign key whose data type disagrees with the key it points at (FR-8.3).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS RULE NEEDS A SYNONYM TABLE TO BE WORTH HAVING
// ─────────────────────────────────────────────────────────────────────────────
//
// `dataType` is free text and not validated against any dialect (SRS §3, FR-1.3), which
// is the right call for the model and an awkward one here: a literal string comparison
// would report a mismatch on nearly every schema the SQL importer produces.
//
//   ORDER.customer_id  integer   ->  CUSTOMER.id  serial
//   ORDER.customer_id  varchar   ->  CUSTOMER.id  character varying
//   ORDER.customer_id  int(11)   ->  CUSTOMER.id  int
//
// None of those three is a mismatch. `serial` IS an integer with a sequence default,
// `character varying` IS varchar's spelled-out name, and MySQL's `int(11)` display width
// carries no type information at all. A rule that cried wolf on all three would be
// switched off within a minute of importing a real dump, so the comparison folds known
// synonyms first and only then compares.
//
// Precision IS compared, for everything except the integer family: `varchar(50)`
// referencing `varchar(255)` is a genuine defect — the referencing column cannot hold
// every value the target can — and the wider-than-needed direction is worth a word too.
// Integer display width is dropped because it means nothing.
//
// When either side has no data type at all the comparison is skipped. That is unknown,
// not mismatched, and reporting it would put this rule in the business of FR-1.3.

import { findAttribute } from '../../graph/indexes'
import type { Diagram } from '../../model/types'
import { attributeLabel, isBlank, issue, type Issue, type Rule } from '../Rule'

/**
 * Spellings that name the same type. Keys are what a dialect might write; values are the
 * form everything folds to. Only entries that actually collide in practice are listed —
 * this is a de-noising table, not an attempt at a type system.
 */
const SYNONYMS: Readonly<Record<string, string>> = {
  // Integer family. `serial` and friends are integers with a default attached, which is
  // a column property rather than a different type.
  int: 'int',
  int4: 'int',
  integer: 'int',
  serial: 'int',
  serial4: 'int',
  int8: 'bigint',
  bigint: 'bigint',
  bigserial: 'bigint',
  serial8: 'bigint',
  int2: 'smallint',
  smallint: 'smallint',
  smallserial: 'smallint',
  serial2: 'smallint',

  // Character family.
  varchar: 'varchar',
  'character varying': 'varchar',
  char: 'char',
  character: 'char',
  text: 'text',

  // Boolean.
  bool: 'boolean',
  boolean: 'boolean',

  // Exact and approximate numerics.
  decimal: 'numeric',
  numeric: 'numeric',
  float8: 'double precision',
  'double precision': 'double precision',
  // `double` is here because OUR OWN SQL importer writes it: `normaliseType` in
  // `io/formats/sql/import.ts` shortens `double precision` to `double` for display.
  // Without this entry, an imported column and a hand-typed one would disagree and this
  // rule would report a mismatch between two spellings of the same type.
  double: 'double precision',
  float4: 'real',
  real: 'real',

  // Date and time. The with/without-time-zone distinction is preserved: it changes what
  // the value means, so it is a mismatch worth reporting.
  timestamptz: 'timestamptz',
  'timestamp with time zone': 'timestamptz',
  timestamp: 'timestamp',
  'timestamp without time zone': 'timestamp',
  timetz: 'timetz',
  'time with time zone': 'timetz',
  time: 'time',
  'time without time zone': 'time',
}

/** Types whose parenthesised argument is a display width and carries no meaning. */
const WIDTH_IS_MEANINGLESS: ReadonlySet<string> = new Set(['int', 'bigint', 'smallint'])

/**
 * Fold a free-text type to a comparable form.
 *
 * Returns the canonical base plus its arguments, e.g. `numeric(10,2)`, `varchar(255)`,
 * `int`. Unknown types pass through with their spelling normalised but otherwise intact,
 * so an exotic or custom type still compares equal to itself.
 */
export function canonicalType(raw: string): string {
  const collapsed = raw.trim().toLocaleLowerCase().replace(/\s+/g, ' ')

  const withArgs = /^(.*?)\s*\(([^)]*)\)\s*(.*)$/.exec(collapsed)
  const base = withArgs === null ? collapsed : `${withArgs[1] ?? ''} ${withArgs[3] ?? ''}`.trim()
  const args = withArgs === null ? '' : (withArgs[2] ?? '').replace(/\s+/g, '')

  const canonical = SYNONYMS[base] ?? base
  if (args === '' || WIDTH_IS_MEANINGLESS.has(canonical)) return canonical

  return `${canonical}(${args})`
}

export const foreignKeyTypeMismatch: Rule = {
  id: 'fk-type-mismatch',
  title: 'Foreign key type does not match its target',
  check(diagram: Diagram): Issue[] {
    const issues: Issue[] = []

    for (const entity of diagram.entities) {
      for (const attribute of entity.attributes) {
        const reference = attribute.foreignKey
        if (reference === undefined) continue

        // Never undefined in practice — the schema enforces FK referential integrity and
        // both delete commands clear inbound references — but this rule is pure and must
        // not assume its caller parsed the document.
        const target = findAttribute(diagram, reference.attributeId)
        if (target === undefined) continue

        const here = attribute.dataType
        const there = target.attribute.dataType
        if (here === undefined || there === undefined || isBlank(here) || isBlank(there)) continue
        if (canonicalType(here) === canonicalType(there)) continue

        const targetEntity = diagram.entities.find((candidate) => candidate.id === target.entityId)
        const targetName =
          targetEntity === undefined ? 'its target' : attributeLabel(targetEntity, target.attribute)

        issues.push(
          issue(
            'fk-type-mismatch',
            'warning',
            { kind: 'attribute', entityId: entity.id, attributeId: attribute.id },
            `${attributeLabel(entity, attribute)} is ${here.trim()} but references ${targetName}, which is ${there.trim()}.`,
          ),
        )
      }
    }

    return issues
  },
}
