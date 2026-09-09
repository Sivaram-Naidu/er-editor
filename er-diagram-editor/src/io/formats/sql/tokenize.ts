// Splitting a DDL script into statements, and identifiers into pieces.
//
// Separated from the parser because almost every bug in a hand-rolled SQL reader is a
// tokenising bug — a semicolon inside a string literal, a comma inside `numeric(10,2)`,
// a `--` inside a quoted name. Getting those wrong produces silently truncated tables
// rather than a loud failure, so they are handled once, here, and tested directly.

export type SqlDialect = 'postgres' | 'mysql'

/**
 * Guess the dialect from the script's own fingerprints.
 *
 * Both dialects accept most of the same DDL, so this only has to be right about the
 * things that actually differ. Backticks and `ENGINE=` are MySQL-only; `SERIAL`,
 * `::casts` and `text[]` are PostgreSQL. When a script shows neither, PostgreSQL is the
 * default — its quoting rules are the ANSI ones, so it is the safer guess for a script
 * that came from somewhere else entirely.
 */
export function detectDialect(sql: string): SqlDialect {
  const withoutStrings = sql.replace(/'(?:[^']|'')*'/g, "''")

  const mysqlSignals = [/`/, /\bengine\s*=/i, /\bauto_increment\b/i, /\bunsigned\b/i]
  const postgresSignals = [/\bserial\b/i, /::/, /\bbigserial\b/i, /\btext\s*\[\s*\]/i]

  const mysqlScore = mysqlSignals.filter((pattern) => pattern.test(withoutStrings)).length
  const postgresScore = postgresSignals.filter((pattern) => pattern.test(withoutStrings)).length

  return mysqlScore > postgresScore ? 'mysql' : 'postgres'
}

/**
 * Remove comments without disturbing string literals.
 *
 * A character-wise scan rather than a regex: `'-- not a comment'` and
 * `'/* also not one *' + '/'` are both legal values, and a regex that strips them
 * corrupts data silently.
 */
export function stripComments(sql: string): string {
  let out = ''
  let index = 0

  while (index < sql.length) {
    const two = sql.slice(index, index + 2)

    if (two === '--') {
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end
      continue
    }

    if (two === '/*') {
      const end = sql.indexOf('*/', index + 2)
      index = end === -1 ? sql.length : end + 2
      continue
    }

    const char = sql[index] ?? ''

    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      let literal = char
      index += 1
      while (index < sql.length) {
        const current = sql[index] ?? ''
        literal += current
        index += 1
        // Doubling is the escape in standard SQL: '' inside '...', "" inside "...".
        if (current === quote) {
          if (sql[index] === quote) {
            literal += quote
            index += 1
            continue
          }
          break
        }
        if (current === '\\' && index < sql.length) {
          literal += sql[index] ?? ''
          index += 1
        }
      }
      out += literal
      continue
    }

    out += char
    index += 1
  }

  return out
}

/** Split on semicolons that are not inside a string, an identifier or parentheses. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let depth = 0
  let index = 0

  while (index < sql.length) {
    const char = sql[index] ?? ''

    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      current += char
      index += 1
      while (index < sql.length) {
        const inner = sql[index] ?? ''
        current += inner
        index += 1
        if (inner === quote && sql[index] !== quote) break
        if (inner === quote) {
          current += quote
          index += 1
        }
      }
      continue
    }

    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)

    if (char === ';' && depth === 0) {
      if (current.trim() !== '') statements.push(current.trim())
      current = ''
      index += 1
      continue
    }

    current += char
    index += 1
  }

  if (current.trim() !== '') statements.push(current.trim())
  return statements
}

/** Strip surrounding quotes and undouble any escaped quote inside. */
export function unquote(raw: string): string {
  const trimmed = raw.trim()
  const first = trimmed[0]

  if (first === '"' || first === '`') {
    return trimmed.slice(1, -1).replaceAll(`${first}${first}`, first)
  }
  // Unquoted identifiers are case-insensitive in both dialects; they are kept verbatim
  // rather than folded, because the case a person typed is the case they want to read.
  return trimmed
}

/**
 * Split a comma-separated list at the top level only.
 *
 * `id numeric(10,2), name text` is two items, not three — the comma inside the type is
 * not a separator. This is the single most common way a naive DDL reader loses columns.
 */
export function splitTopLevel(body: string, separator = ','): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let index = 0

  while (index < body.length) {
    const char = body[index] ?? ''

    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      current += char
      index += 1
      while (index < body.length) {
        const inner = body[index] ?? ''
        current += inner
        index += 1
        if (inner === quote) break
      }
      continue
    }

    if (char === '(') depth += 1
    if (char === ')') depth -= 1

    if (char === separator && depth === 0) {
      parts.push(current.trim())
      current = ''
      index += 1
      continue
    }

    current += char
    index += 1
  }

  if (current.trim() !== '') parts.push(current.trim())
  return parts
}

/** Contents of the outermost parenthesised group, or undefined if there is none. */
export function parenBody(text: string): string | undefined {
  const open = text.indexOf('(')
  if (open === -1) return undefined

  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, index)
    }
  }
  return undefined
}

/** `schema.table` or `"schema"."table"` — the table part is what we key on. */
export function tableName(raw: string): string {
  const parts = splitTopLevel(raw.trim(), '.')
  return unquote(parts.at(-1) ?? raw)
}
