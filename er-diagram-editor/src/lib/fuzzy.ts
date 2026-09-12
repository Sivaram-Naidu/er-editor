// Fuzzy matching over short identifier-like names (FR-2.6).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS HAND-ROLLED AND NOT `fuse.js`
// ─────────────────────────────────────────────────────────────────────────────
//
// `fuse.js` was a dependency for six stages without ever being imported, and left in the
// 10 Sep 2026 click-to-select commit — as a side effect, note: that commit's message never
// mentions it, so "deliberately removed" overstates the record. Re-adding it needs a
// reason and the numbers do not supply one.
//
// The corpus is every entity, attribute and relationship name in ONE diagram. Counted from
// `tests/fixtures/referenceSchema.ts`, the 120-entity reference schema is 120 entity names
// + 960 attribute names + 150 relationship names = **1,230 strings**; NFR-2.2's 300-entity
// ceiling is roughly 3,000. NFR-1.7 allows 50 ms from the final keystroke. A linear pass
// over 3,000 short identifiers is not close to that bound, so a library would buy speed
// nobody needs.
//
// Cost if it were taken anyway, measured rather than looked up: fuse.min + cmdk is
// 13,488 B gzip against NFR-1.8's 500 KB budget, on an entry chunk currently at 222 KB
// gzip. Affordable — which is why the argument against is fit, not weight. Every candidate
// here is a short identifier, and generic scoring tuned for prose ranks them badly.
//
// What it is NOT is a general-purpose fuzzy search. It is tuned for one shape of string:
// `customer_id`, `ORDER_LINE`, `shippedAt`. Do not reach for it to match prose.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY TIERS RATHER THAN ONE SCORE
// ─────────────────────────────────────────────────────────────────────────────
//
// The obvious design is a single score built by adding bonuses — consecutive run, word
// boundary, distance from the start — and it is very hard to tune, because the weights
// interact and every fix for one query breaks another. Ranking by KIND first and only
// then by a tiebreak makes the ordering explainable and testable: typing `order` must put
// `ORDER` above `ORDER_LINE` above `customer_order_id`, and that is three assertions
// about tiers rather than three assertions about arithmetic nobody can predict.
//
// The kinds are ordered by how much of the candidate the query accounts for, which is the
// same thing as how confident we are that the user meant this one.

/** How a query matched, best first. The ordinal IS the ranking. */
export type MatchKind = 'exact' | 'prefix' | 'acronym' | 'substring' | 'subsequence'

const KIND_RANK: Record<MatchKind, number> = {
  exact: 0,
  prefix: 1,
  acronym: 2,
  substring: 3,
  subsequence: 4,
}

export interface FuzzyMatch {
  kind: MatchKind
  /** Lower sorts first. Compare with `compareMatches` rather than reading this. */
  rank: number
  /** Indices into the candidate that matched, ascending. For highlighting. */
  positions: readonly number[]
}

/**
 * Characters that start a new word, so `oi` can find `order_id` and `OrderId`.
 *
 * Deliberately includes `.`: an attribute is shown to the user as `CUSTOMER.id`, and
 * someone typing `ci` expects to find it.
 */
const SEPARATORS = new Set([' ', '_', '-', '.', '/', '\\', ':'])

function isBoundary(candidate: string, index: number): boolean {
  if (index === 0) return true
  // `charAt` rather than indexing: it returns '' out of range, so the bounds are handled
  // by the language instead of by a non-null assertion, which `src/` does not allow.
  const previous = candidate.charAt(index - 1)
  if (SEPARATORS.has(previous)) return true
  // camelCase: a lower-to-upper transition starts a word. Compared on the raw string,
  // because the lower-cased copy used for matching has thrown this information away.
  const here = candidate.charAt(index)
  return previous === previous.toLowerCase() && here !== here.toLowerCase()
}

/** The index of every character that starts a word, in order. */
function boundaries(candidate: string): number[] {
  const found: number[] = []
  for (let index = 0; index < candidate.length; index++) {
    if (isBoundary(candidate, index)) found.push(index)
  }
  return found
}

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => start + offset)
}

/**
 * Match `query` against `candidate`, or `undefined` if it does not match at all.
 *
 * An empty query matches nothing rather than everything: the palette shows commands when
 * the box is empty, and a match of every name in the schema is not a useful alternative
 * to that.
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | undefined {
  /*
   * `toLocaleLowerCase`, matching `normalise()` in domain/validation/rules/duplicate-names.ts.
   *
   * That rule folds case because `Order` and `ORDER` are the same table to PostgreSQL and
   * to MySQL on Windows and macOS, and SQL import is how a 100-table diagram arrives. A
   * search box that disagreed with the rule about what counts as the same name would be a
   * second opinion on the same question — someone warned about a duplicate could then fail
   * to find it by typing the other case.
   */
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0 || candidate.length === 0) return undefined

  const haystack = candidate.toLocaleLowerCase()

  if (haystack === needle) {
    return { kind: 'exact', rank: tiebreak('exact', 0, candidate), positions: range(0, candidate.length) }
  }

  if (haystack.startsWith(needle)) {
    return { kind: 'prefix', rank: tiebreak('prefix', 0, candidate), positions: range(0, needle.length) }
  }

  // Acronym: every query character is the first letter of a word, in order. `col` finds
  // `customer_order_line`. Checked before substring because it expresses stronger intent
  // — the user spelled out the structure of the name.
  const starts = boundaries(candidate)
  if (needle.length > 1 && starts.length >= needle.length) {
    const picked: number[] = []
    let cursor = 0
    for (const character of needle) {
      let start = starts[cursor]
      while (start !== undefined && haystack.charAt(start) !== character) {
        cursor++
        start = starts[cursor]
      }
      if (start === undefined) break
      picked.push(start)
      cursor++
    }
    if (picked.length === needle.length) {
      return {
        kind: 'acronym',
        rank: tiebreak('acronym', picked[0] ?? 0, candidate),
        positions: picked,
      }
    }
  }

  const at = haystack.indexOf(needle)
  if (at !== -1) {
    return { kind: 'substring', rank: tiebreak('substring', at, candidate), positions: range(at, needle.length) }
  }

  // Subsequence, greedy but boundary-preferring: when the next needle character occurs
  // both mid-word and at the start of a later word, take the later one. Without this,
  // `cid` in `customer_identity` matches c-i-d inside "customer"/"identity" at
  // uninformative places and highlights read as noise.
  const positions: number[] = []
  let from = 0
  for (const character of needle) {
    const plain = haystack.indexOf(character, from)
    if (plain === -1) return undefined

    let chosen = plain
    for (const start of starts) {
      if (start < from) continue
      if (start <= plain) continue
      if (haystack.charAt(start) === character) {
        chosen = start
        break
      }
    }
    positions.push(chosen)
    from = chosen + 1
  }

  return {
    kind: 'subsequence',
    rank: tiebreak('subsequence', positions[0] ?? 0, candidate),
    positions,
  }
}

/**
 * Fold kind, match position and candidate length into one sortable number.
 *
 * Packed rather than compared field by field so a caller can sort on a single key, and
 * spaced so the fields cannot bleed into each other: kind dominates, then how early the
 * match starts, then how much of the candidate is left over. The last term is what puts
 * `ORDER` above `ORDER_LINE` for the query `order` — both are prefix matches starting at
 * 0, and the shorter one is the better answer.
 */
function tiebreak(kind: MatchKind, start: number, candidate: string): number {
  const position = Math.min(start, 999)
  const length = Math.min(candidate.length, 999)
  return KIND_RANK[kind] * 1_000_000 + position * 1_000 + length
}

/** Sort comparator: better matches first. */
export function compareMatches(a: FuzzyMatch, b: FuzzyMatch): number {
  return a.rank - b.rank
}
