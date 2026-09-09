// IR -> .mmd. V1 primary export target (FR-6.1).
//
// Mermaid's `erDiagram` grammar supports: entities with typed attributes, PK/FK/UK
// markers, attribute comments, crow's-foot cardinality, relationship labels, and
// identifying vs non-identifying via solid `--` and dotted `..`.
//
// Everything else in our IR has to be approximated or decomposed. What that means per
// construct is declared in capabilities.ts and reported to the user before they commit
// (FR-6.3); this file's job is only to produce the best text it can.

import type {
  Attribute,
  Cardinality,
  Diagram,
  Entity,
  Participation,
  Relationship,
} from '../../../domain'
import { computeLoss } from '../../capabilities'
import type { ExportResult } from '../../types'

import { mermaidCapabilities, mermaidExplanations } from './capabilities'

/**
 * Mermaid identifiers allow letters, digits, underscores and hyphens. Anything else has
 * to go, and an empty result needs a stand-in — an entity block with no name is a parse
 * error, which would make the whole file unopenable because of one unnamed table.
 */
function identifier(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/[^\w-]/g, '_')
  return cleaned === '' ? fallback : cleaned
}

/** Mermaid type tokens are bare words; `varchar(255)` must lose its punctuation. */
function typeToken(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return 'string'
  return raw.trim().replace(/[^\w]/g, '_')
}

/** Comments are quoted, so an embedded quote would terminate the string early. */
function quote(text: string): string {
  return `"${text.replace(/"/g, "'")}"`
}

/**
 * Everything worth saying about an attribute that Mermaid cannot say structurally.
 *
 * The Chen-only flags land here rather than being silently dropped: a reader of the
 * exported file still learns that `phone_numbers` is multivalued, even though Mermaid
 * has no way to draw it.
 */
function attributeComment(attribute: Attribute): string | undefined {
  const notes: string[] = []
  if (attribute.comment !== undefined && attribute.comment !== '') notes.push(attribute.comment)
  if (attribute.isMultivalued) notes.push('multivalued')
  if (attribute.isDerived) notes.push('derived')
  if (attribute.isNullable) notes.push('nullable')
  return notes.length === 0 ? undefined : notes.join('; ')
}

/** PK, FK and UK are the only key markers Mermaid understands. */
function keyMarkers(attribute: Attribute): string {
  const markers: string[] = []
  if (attribute.isPrimaryKey) markers.push('PK')
  if (attribute.foreignKey !== undefined) markers.push('FK')
  if (attribute.isUnique && !attribute.isPrimaryKey) markers.push('UK')
  return markers.join(', ')
}

/**
 * Flatten a composite attribute into `parent_child` rows.
 *
 * Mermaid has no nesting. Emitting only the parent would lose the parts; emitting the
 * parts under a compound name keeps every field and loses only the grouping, which is
 * the smaller loss.
 */
function flatten(attribute: Attribute, prefix = ''): Attribute[] {
  const name = `${prefix}${attribute.name || 'unnamed'}`
  const children = attribute.children

  if (children === undefined || children.length === 0) return [{ ...attribute, name }]
  return children.flatMap((child) => flatten(child, `${name}_`))
}

function attributeLine(attribute: Attribute): string {
  const parts = [typeToken(attribute.dataType), identifier(attribute.name, 'field')]

  const markers = keyMarkers(attribute)
  if (markers !== '') parts.push(markers)

  const comment = attributeComment(attribute)
  if (comment !== undefined) parts.push(quote(comment))

  return `    ${parts.join(' ')}`
}

function entityBlock(entity: Entity, name: string): string[] {
  const lines = [`  ${name} {`]

  for (const attribute of entity.attributes) {
    for (const flattened of flatten(attribute)) lines.push(attributeLine(flattened))
  }

  lines.push('  }')
  return lines
}

/**
 * Crow's-foot token for one end.
 *
 * Mermaid's left and right tokens are mirror images, so each end needs the right one:
 * `||--o{` reads "exactly one to zero-or-more".
 */
function cardinalityToken(
  cardinality: Cardinality,
  participation: Participation,
  side: 'left' | 'right',
): string {
  if (cardinality === 'one') {
    if (participation === 'total') return '||'
    return side === 'left' ? 'o|' : '|o'
  }
  if (participation === 'total') return side === 'left' ? '}|' : '|{'
  return side === 'left' ? '}o' : 'o{'
}

function relationshipLine(
  relationship: Relationship,
  nameOf: (id: string) => string,
): string | undefined {
  const [from, to] = relationship.participants
  if (from === undefined || to === undefined) return undefined

  const left = cardinalityToken(from.cardinality, from.participation, 'left')
  const right = cardinalityToken(to.cardinality, to.participation, 'right')
  // Solid for identifying, dotted for non-identifying — the same distinction the canvas
  // draws, and one of the few Chen concepts Mermaid represents exactly.
  const line = relationship.isIdentifying ? '--' : '..'
  const label = relationship.name === '' ? 'relates to' : relationship.name

  return `  ${nameOf(from.entityId)} ${left}${line}${right} ${nameOf(to.entityId)} : ${quote(label)}`
}

export function exportMermaid(diagram: Diagram): ExportResult {
  // Names are deduplicated up front. Two entities called CUSTOMER would collapse into one
  // block in Mermaid and silently merge their fields.
  const used = new Set<string>()
  const nameById = new Map<string, string>()

  diagram.entities.forEach((entity, index) => {
    const base = identifier(entity.name, `ENTITY_${String(index + 1)}`)
    let name = base
    let suffix = 2
    while (used.has(name)) name = `${base}_${String(suffix++)}`
    used.add(name)
    nameById.set(entity.id, name)
  })

  const nameOf = (id: string): string => nameById.get(id) ?? 'UNKNOWN'

  const lines: string[] = []
  lines.push(`%% ${diagram.name}`)
  lines.push('%% Exported from ER Diagram Editor')

  const weak = diagram.entities.filter((entity) => entity.kind === 'weak')
  if (weak.length > 0) {
    lines.push(
      `%% Weak entities (no Mermaid equivalent): ${weak.map((entity) => nameOf(entity.id)).join(', ')}`,
    )
  }

  lines.push('erDiagram')

  for (const entity of diagram.entities) {
    lines.push(...entityBlock(entity, nameOf(entity.id)))
  }

  for (const relationship of diagram.relationships) {
    const line = relationshipLine(relationship, nameOf)
    if (line !== undefined) lines.push(line)
  }

  return {
    content: `${lines.join('\n')}\n`,
    lossReport: computeLoss(diagram, mermaidCapabilities, mermaidExplanations),
  }
}
