// .mmd -> IR (FR-6.8).
//
// `erDiagram` is a small line-oriented grammar, so this is a line reader rather than a
// parser proper. What it must handle:
//
//   ENTITY { type name PK "comment" }        entity blocks
//   A ||--o{ B : "label"                     relationships, solid or dotted
//   %% anything                              comments
//
// Round-tripping our own export is the design target: anything this tool wrote, it can
// read back. Files from elsewhere are read on a best-effort basis, with whatever could
// not be understood reported rather than thrown.
//
// Positions are not in the format at all, so an imported diagram has no layout — the
// caller is expected to run auto-layout, which is why FR-6.8 pairs the two.

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Attribute,
  type Cardinality,
  type Entity,
  type Participation,
} from '../../../domain'
import type { ImportResult } from '../../types'

/**
 * Mermaid's cardinality tokens.
 *
 * Both spellings of each end are listed because Mermaid mirrors them: the left end of
 * "zero or more" is `}o` and the right end is `o{`. Reading only one spelling would
 * silently invert half the relationships in a file.
 */
const CARDINALITY: Record<string, { cardinality: Cardinality; participation: Participation }> = {
  '||': { cardinality: 'one', participation: 'total' },
  'o|': { cardinality: 'one', participation: 'partial' },
  '|o': { cardinality: 'one', participation: 'partial' },
  '}|': { cardinality: 'many', participation: 'total' },
  '|{': { cardinality: 'many', participation: 'total' },
  '}o': { cardinality: 'many', participation: 'partial' },
  'o{': { cardinality: 'many', participation: 'partial' },
}

const RELATIONSHIP =
  /^(\S+)\s+([|}o][|{o])(--|\.\.)([|}o][|{o])\s+(\S+)\s*:\s*(?:"([^"]*)"|(\S+))\s*$/

function parseAttributeLine(line: string): Attribute | undefined {
  // `type name MARKERS "comment"` — the comment is optional and always last.
  const commentMatch = /"([^"]*)"\s*$/.exec(line)
  const comment = commentMatch?.[1]
  const withoutComment = commentMatch === null ? line : line.slice(0, commentMatch.index).trim()

  const tokens = withoutComment.split(/\s+/).filter((token) => token !== '')
  if (tokens.length < 2) return undefined

  const [dataType, name, ...rest] = tokens
  if (dataType === undefined || name === undefined) return undefined

  const markers = rest.join(' ').toUpperCase()
  const isPrimaryKey = /\bPK\b/.test(markers)

  // Our own exporter writes nullability into the comment, so reading it back keeps a
  // round-trip faithful. A file from elsewhere simply has no opinion, and SQL's default
  // — nullable — is the right assumption.
  const notes = (comment ?? '').toLowerCase()
  const isNullable = isPrimaryKey ? false : !notes.includes('not null')

  // Strip the flags we ourselves wrote so they do not reappear as literal comment text.
  const humanComment = (comment ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(
      (part) =>
        part !== '' &&
        !['multivalued', 'derived', 'nullable', 'not null'].includes(part.toLowerCase()),
    )
    .join('; ')

  return createAttribute({
    name,
    dataType: dataType === 'string' ? 'string' : dataType,
    isPrimaryKey,
    isUnique: isPrimaryKey || /\bUK\b/.test(markers),
    isNullable,
    isMultivalued: notes.includes('multivalued'),
    isDerived: notes.includes('derived'),
    ...(humanComment === '' ? {} : { comment: humanComment }),
  })
}

export function importMermaid(content: string): ImportResult {
  const warnings: string[] = []
  const lines = content.split(/\r?\n/)

  const entities = new Map<string, Entity>()
  const pending: {
    from: string
    to: string
    label: string
    identifying: boolean
    fromToken: string
    toToken: string
  }[] = []

  let current: { name: string; attributes: Attribute[] } | undefined
  let sawHeader = false

  for (const raw of lines) {
    const line = raw.trim()
    if (line === '' || line.startsWith('%%')) continue

    if (/^erdiagram\b/i.test(line)) {
      sawHeader = true
      continue
    }

    if (current !== undefined) {
      if (line === '}') {
        entities.set(
          current.name.toLowerCase(),
          createEntity({ name: current.name, attributes: current.attributes }),
        )
        current = undefined
        continue
      }
      const attribute = parseAttributeLine(line)
      if (attribute === undefined) warnings.push(`Could not read field line: ${line}`)
      else current.attributes.push(attribute)
      continue
    }

    const blockMatch = /^(\S+)\s*\{$/.exec(line)
    if (blockMatch !== null) {
      current = { name: blockMatch[1] ?? 'ENTITY', attributes: [] }
      continue
    }

    const relationshipMatch = RELATIONSHIP.exec(line)
    if (relationshipMatch !== null) {
      pending.push({
        from: relationshipMatch[1] ?? '',
        to: relationshipMatch[5] ?? '',
        label: relationshipMatch[6] ?? relationshipMatch[7] ?? '',
        // Solid means identifying, dotted means not — the same convention we export.
        identifying: relationshipMatch[3] === '--',
        fromToken: relationshipMatch[2] ?? '||',
        toToken: relationshipMatch[4] ?? 'o{',
      })
      continue
    }

    // A bare `ENTITY` with no block is legal Mermaid; it declares a table with no fields.
    if (/^[\w-]+$/.test(line)) {
      entities.set(line.toLowerCase(), createEntity({ name: line }))
      continue
    }

    warnings.push(`Could not read line: ${line}`)
  }

  if (!sawHeader) {
    throw new Error('That file does not look like a Mermaid ER diagram — no `erDiagram` line.')
  }

  // Relationships may name entities that never got a block of their own.
  for (const relationship of pending) {
    for (const name of [relationship.from, relationship.to]) {
      if (!entities.has(name.toLowerCase())) {
        entities.set(name.toLowerCase(), createEntity({ name }))
      }
    }
  }

  if (entities.size === 0) throw new Error('No entities found in that file.')

  const relationships = pending.flatMap((item) => {
    const from = entities.get(item.from.toLowerCase())
    const to = entities.get(item.to.toLowerCase())
    if (from === undefined || to === undefined) return []

    // Cardinality is carried through rather than defaulted. Falling back to 1 : 0..N
    // would quietly rewrite every many-to-many in the file into a one-to-many.
    const fromEnd = CARDINALITY[item.fromToken] ?? { cardinality: 'one', participation: 'total' }
    const toEnd = CARDINALITY[item.toToken] ?? { cardinality: 'many', participation: 'partial' }

    return [
      createRelationship({
        from: from.id,
        to: to.id,
        // Our exporter writes "relates to" for an unnamed relationship, so reading it
        // back as a real name would make a round-trip gain a label it never had.
        name: item.label === 'relates to' ? '' : item.label,
        isIdentifying: item.identifying,
        fromEnd,
        toEnd,
      }),
    ]
  })

  return {
    diagram: createDiagram({
      name: 'Imported diagram',
      entities: [...entities.values()],
      relationships,
    }),
    warnings: [
      'Mermaid files carry no layout, so the diagram has been arranged automatically.',
      ...warnings,
    ],
  }
}

export { CARDINALITY }
