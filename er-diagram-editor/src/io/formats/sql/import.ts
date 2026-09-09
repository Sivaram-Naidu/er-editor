// CREATE TABLE / ALTER TABLE -> IR.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A HAND-ROLLED SUBSET RATHER THAN A REAL SQL PARSER
// ─────────────────────────────────────────────────────────────────────────────
//
// A full parser (node-sql-parser and friends) handles far more, at the cost of a large
// dependency that would need lazy-loading and a dialect setting exposed as a UI concern.
// What this importer needs is narrow: table shapes and the references between them. Every
// other clause — storage engines, partitioning, triggers, grants — is noise for a
// diagram.
//
// So this reads the DDL subset that actually describes structure and SKIPS the rest,
// reporting what it skipped rather than failing the file. A schema dump that is 90%
// readable should produce 90% of a diagram, not an error message.
//
// If the subset proves too narrow, the ImportAdapter interface means swapping in a real
// parser touches this file and nothing else.

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Attribute,
  type AttributeId,
  type Diagram,
  type Entity,
} from '../../../domain'
import type { ImportResult } from '../../types'

import {
  detectDialect,
  parenBody,
  splitStatements,
  splitTopLevel,
  stripComments,
  tableName,
  unquote,
  type SqlDialect,
} from './tokenize'

export interface SqlImportOptions {
  dialect?: SqlDialect | 'auto'
  diagramName?: string
}

/** A reference collected during parsing, resolved to ids once every table is known. */
interface PendingReference {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string | undefined
}

/**
 * Clauses that are table-level constraints rather than columns.
 *
 * Checked as a prefix so `CONSTRAINT fk_x FOREIGN KEY ...` is recognised too.
 */
const TABLE_CONSTRAINT =
  /^(constraint\s+\S+\s+)?(primary\s+key|foreign\s+key|unique|check|key|index)\b/i

/** Column-level flags. Order matters only in that longer forms are tested first. */
function parseColumn(
  clause: string,
  dialect: SqlDialect,
):
  | {
      attribute: Attribute
      reference: { toTable: string; toColumn: string | undefined } | undefined
    }
  | undefined {
  const trimmed = clause.trim()
  if (trimmed === '') return undefined

  // `name TYPE rest...`. The name may be quoted, so it is taken up to the first
  // whitespace outside quotes.
  const nameMatch = /^(`[^`]+`|"[^"]+"|\[[^\]]+\]|[\w$]+)\s+(.*)$/s.exec(trimmed)
  if (nameMatch === null) return undefined

  const name = unquote(nameMatch[1] ?? '')
  const rest = nameMatch[2] ?? ''

  // The type runs to the first constraint keyword, keeping any parenthesised precision.
  //
  // Multi-word types are matched first. Standard SQL spells several types as phrases —
  // `character varying(255)`, `double precision`, `timestamp with time zone` — and a
  // single-word pattern grabs only `character`, leaving `varying(255)` to be misread as
  // a constraint. That produced a column typed `character` with the length silently gone.
  const MULTI_WORD =
    /^((?:character\s+varying|bit\s+varying|double\s+precision|timestamp\s+with(?:out)?\s+time\s+zone|time\s+with(?:out)?\s+time\s+zone)(\s*\([^)]*\))?)/i
  const typeMatch =
    MULTI_WORD.exec(rest) ??
    /^([\w$]+(\s*\([^)]*\))?(\s+(unsigned|zerofill))*(\s*\[\s*\])?)/i.exec(rest)
  const dataType = typeMatch?.[1]?.trim().replace(/\s+/g, ' ')
  const tail = rest.slice(typeMatch?.[0].length ?? 0)

  const isPrimaryKey = /\bprimary\s+key\b/i.test(tail)
  const isUnique = isPrimaryKey || /\bunique\b/i.test(tail)
  // `NOT NULL` wins; a bare `NULL` is explicit nullability; absent means nullable, which
  // is the SQL default. A primary key is non-nullable by definition in both dialects.
  const isNullable = isPrimaryKey ? false : !/\bnot\s+null\b/i.test(tail)

  // `GENERATED ALWAYS AS (...)` and MySQL's `AS (...) VIRTUAL` are computed columns —
  // exactly what a derived attribute means in ER terms.
  const isDerived = /\b(generated\s+always\s+as|virtual|stored)\b/i.test(tail)

  const defaultMatch = /\bdefault\s+('(?:[^']|'')*'|[\w.$]+(\s*\([^)]*\))?)/i.exec(tail)
  const commentMatch = /\bcomment\s+'((?:[^']|'')*)'/i.exec(tail)

  const referenceMatch = /\breferences\s+((?:`[^`]+`|"[^"]+"|[\w$.]+))\s*(\(([^)]*)\))?/i.exec(tail)

  const attribute: Attribute = {
    ...createAttribute({
      name,
      isPrimaryKey,
      isUnique,
      isNullable,
      isDerived,
      ...(dataType === undefined ? {} : { dataType: normaliseType(dataType, dialect) }),
      ...(defaultMatch?.[1] === undefined ? {} : { defaultValue: defaultMatch[1] }),
      ...(commentMatch?.[1] === undefined
        ? {}
        : { comment: commentMatch[1].replaceAll("''", "'") }),
    }),
  }

  const reference =
    referenceMatch === null
      ? undefined
      : {
          toTable: tableName(referenceMatch[1] ?? ''),
          toColumn:
            referenceMatch[3] === undefined
              ? undefined
              : unquote(referenceMatch[3].split(',')[0] ?? ''),
        }

  return { attribute, reference }
}

/**
 * Tidy a type for display.
 *
 * MySQL's `int(11)` display width is meaningless and noisy on a diagram; PostgreSQL's
 * `character varying` is spelled `varchar` by everyone who reads it.
 */
function normaliseType(raw: string, dialect: SqlDialect): string {
  let type = raw.trim().replace(/\s+/g, ' ')

  if (dialect === 'mysql') {
    type = type.replace(/^(int|bigint|smallint|tinyint)\s*\(\d+\)/i, '$1')
  }
  type = type.replace(/^character varying/i, 'varchar')
  type = type.replace(/^timestamp with time zone/i, 'timestamptz')
  type = type.replace(/^double precision/i, 'double')

  return type
}

interface ParsedTable {
  name: string
  entity: Entity
  columnIdByName: Map<string, AttributeId>
}

export function importSql(content: string, options: SqlImportOptions = {}): ImportResult {
  const dialect =
    options.dialect === undefined || options.dialect === 'auto'
      ? detectDialect(content)
      : options.dialect

  const warnings: string[] = []
  const statements = splitStatements(stripComments(content))

  const tables = new Map<string, ParsedTable>()
  const references: PendingReference[] = []
  let skipped = 0

  for (const statement of statements) {
    const createMatch =
      /^create\s+(?:global\s+|local\s+)?(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:(?:`[^`]+`|"[^"]+"|[\w$]+)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[\w$]+))*))/i.exec(
        statement,
      )

    if (createMatch !== null) {
      const name = tableName(createMatch[1] ?? '')
      const body = parenBody(statement)
      if (body === undefined) {
        warnings.push(`Skipped "${name}": could not read its column list.`)
        continue
      }

      const attributes: Attribute[] = []
      const columnIdByName = new Map<string, AttributeId>()
      const primaryKeyNames: string[] = []
      const uniqueNames: string[] = []

      for (const clause of splitTopLevel(body)) {
        if (TABLE_CONSTRAINT.test(clause)) {
          // Table-level constraints are collected and applied after the columns exist.
          const fkMatch =
            /\bforeign\s+key\s*\(([^)]*)\)\s*references\s+((?:(?:`[^`]+`|"[^"]+"|[\w$]+)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[\w$]+))*))\s*(\(([^)]*)\))?/i.exec(
              clause,
            )
          if (fkMatch !== null) {
            references.push({
              fromTable: name,
              fromColumn: unquote(fkMatch[1]?.split(',')[0] ?? ''),
              toTable: tableName(fkMatch[2] ?? ''),
              toColumn:
                fkMatch[4] === undefined ? undefined : unquote(fkMatch[4].split(',')[0] ?? ''),
            })
            continue
          }

          const pkMatch = /\bprimary\s+key\s*\(([^)]*)\)/i.exec(clause)
          if (pkMatch !== null) {
            // Composite keys are supported: every named column is marked, not just the
            // first (SRS §4.1).
            for (const column of splitTopLevel(pkMatch[1] ?? '')) {
              primaryKeyNames.push(unquote(column))
            }
            continue
          }

          const uniqueMatch =
            /^(?:constraint\s+\S+\s+)?unique\s*(?:key\s+\S+\s*)?\(([^)]*)\)/i.exec(clause)
          if (uniqueMatch !== null) {
            for (const column of splitTopLevel(uniqueMatch[1] ?? '')) {
              uniqueNames.push(unquote(column))
            }
          }
          continue
        }

        const parsed = parseColumn(clause, dialect)
        if (parsed === undefined) continue

        attributes.push(parsed.attribute)
        columnIdByName.set(parsed.attribute.name.toLowerCase(), parsed.attribute.id)

        if (parsed.reference !== undefined) {
          references.push({
            fromTable: name,
            fromColumn: parsed.attribute.name,
            toTable: parsed.reference.toTable,
            toColumn: parsed.reference.toColumn,
          })
        }
      }

      for (const [index, attribute] of attributes.entries()) {
        const lower = attribute.name.toLowerCase()
        if (primaryKeyNames.some((candidate) => candidate.toLowerCase() === lower)) {
          attributes[index] = {
            ...attribute,
            isPrimaryKey: true,
            isUnique: true,
            isNullable: false,
          }
        } else if (uniqueNames.some((candidate) => candidate.toLowerCase() === lower)) {
          attributes[index] = { ...attribute, isUnique: true }
        }
      }

      tables.set(name.toLowerCase(), {
        name,
        entity: createEntity({ name, attributes }),
        columnIdByName,
      })
      continue
    }

    // `ALTER TABLE x ADD CONSTRAINT ... FOREIGN KEY (a) REFERENCES y (b)` — how most
    // dumps declare their foreign keys, since it lets tables be created in any order.
    const alterMatch =
      /^alter\s+table\s+(?:only\s+)?((?:(?:`[^`]+`|"[^"]+"|[\w$]+)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[\w$]+))*))[\s\S]*?\bforeign\s+key\s*\(([^)]*)\)\s*references\s+((?:(?:`[^`]+`|"[^"]+"|[\w$]+)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[\w$]+))*))\s*(\(([^)]*)\))?/i.exec(
        statement,
      )
    if (alterMatch !== null) {
      references.push({
        fromTable: tableName(alterMatch[1] ?? ''),
        fromColumn: unquote(alterMatch[2]?.split(',')[0] ?? ''),
        toTable: tableName(alterMatch[3] ?? ''),
        toColumn:
          alterMatch[5] === undefined ? undefined : unquote(alterMatch[5].split(',')[0] ?? ''),
      })
      continue
    }

    // Everything else — indexes, grants, sequences, inserts — is not structure.
    if (
      /^(create|alter|drop|insert|set|comment|grant|revoke|begin|commit|use)\b/i.test(statement)
    ) {
      skipped += 1
    }
  }

  if (tables.size === 0) {
    throw new Error('No CREATE TABLE statements found in that file.')
  }

  const entities = [...tables.values()].map((table) => table.entity)
  // Foreign keys are wired only once every table exists, so forward references and
  // ALTER-based declarations both resolve.
  const relationships = []
  const seenPairs = new Set<string>()

  for (const reference of references) {
    const fromTable = tables.get(reference.fromTable.toLowerCase())
    const toTable = tables.get(reference.toTable.toLowerCase())

    if (fromTable === undefined || toTable === undefined) {
      warnings.push(
        `Reference from ${reference.fromTable}.${reference.fromColumn} to ${reference.toTable} was skipped — that table is not in this file.`,
      )
      continue
    }

    const targetColumn =
      reference.toColumn === undefined
        ? toTable.entity.attributes.find((attribute) => attribute.isPrimaryKey)
        : toTable.entity.attributes.find(
            (attribute) => attribute.name.toLowerCase() === reference.toColumn?.toLowerCase(),
          )

    const sourceIndex = fromTable.entity.attributes.findIndex(
      (attribute) => attribute.name.toLowerCase() === reference.fromColumn.toLowerCase(),
    )

    if (targetColumn !== undefined && sourceIndex !== -1) {
      const source = fromTable.entity.attributes[sourceIndex]
      if (source !== undefined) {
        fromTable.entity.attributes[sourceIndex] = {
          ...source,
          foreignKey: { entityId: toTable.entity.id, attributeId: targetColumn.id },
        }
      }
    }

    // One line per pair of tables, however many columns join them — a composite foreign
    // key is one relationship, not three parallel edges.
    const pairKey = [fromTable.entity.id, toTable.entity.id].sort().join('|')
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)

    relationships.push(createRelationship({ from: toTable.entity.id, to: fromTable.entity.id }))
  }

  if (skipped > 0) {
    warnings.push(
      `${String(skipped)} statement${skipped === 1 ? '' : 's'} that do not describe table structure were ignored.`,
    )
  }

  const diagram: Diagram = createDiagram({
    name: options.diagramName ?? 'Imported schema',
    entities,
    relationships,
  })

  return {
    diagram,
    warnings: [`Read as ${dialect === 'mysql' ? 'MySQL' : 'PostgreSQL'}.`, ...warnings],
  }
}

export type { SqlDialect }
export { detectDialect }
