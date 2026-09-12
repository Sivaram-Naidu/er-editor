/**
 * The matcher behind the Ctrl+K box (FR-2.6).
 *
 * These are mostly ORDERING assertions rather than "does it match" ones, because ordering
 * is the whole job: a search over 2,000 identifier-like names will match plenty of them
 * for any short query, and what makes the box usable is which one is first. The tiers in
 * `fuzzy.ts` exist so those assertions can be written at all — a single tuned score would
 * make every one of these a guess about arithmetic.
 */
import { describe, expect, it } from 'vitest'

import { compareMatches, fuzzyMatch, type FuzzyMatch } from '../../../src/lib/fuzzy'

/** The candidates that matched, best first — what the palette actually renders. */
function rank(query: string, candidates: readonly string[]): string[] {
  return candidates
    .flatMap((candidate) => {
      const match = fuzzyMatch(query, candidate)
      return match === undefined ? [] : [{ candidate, match }]
    })
    .sort((a, b) => compareMatches(a.match, b.match))
    .map((hit) => hit.candidate)
}

function kindOf(query: string, candidate: string): FuzzyMatch['kind'] | undefined {
  return fuzzyMatch(query, candidate)?.kind
}

describe('fuzzyMatch', () => {
  it('does not match an empty query', () => {
    // The palette shows the command list when the box is empty. Matching every name in
    // the schema instead would be strictly worse than showing nothing.
    expect(fuzzyMatch('', 'CUSTOMER')).toBeUndefined()
    expect(fuzzyMatch('   ', 'CUSTOMER')).toBeUndefined()
  })

  it('does not match when a character is missing', () => {
    expect(fuzzyMatch('xyz', 'CUSTOMER')).toBeUndefined()
    // Right characters, wrong order — a subsequence is ordered.
    expect(fuzzyMatch('remo', 'CUSTOMER')).toBeUndefined()
  })

  it('is case-insensitive in both directions', () => {
    expect(kindOf('customer', 'CUSTOMER')).toBe('exact')
    expect(kindOf('CUSTOMER', 'customer')).toBe('exact')
  })

  it('classifies each kind of match', () => {
    expect(kindOf('order', 'ORDER')).toBe('exact')
    expect(kindOf('ord', 'ORDER_LINE')).toBe('prefix')
    expect(kindOf('col', 'customer_order_line')).toBe('acronym')
    expect(kindOf('line', 'ORDER_LINE')).toBe('substring')
    expect(kindOf('oid', 'order_paid_at')).toBe('subsequence')
  })

  it('puts the shorter candidate first when both are prefix matches', () => {
    // The reason the tiebreak carries candidate length at all.
    expect(rank('order', ['ORDER_LINE', 'ORDER', 'ORDER_LINE_ITEM'])).toEqual([
      'ORDER',
      'ORDER_LINE',
      'ORDER_LINE_ITEM',
    ])
  })

  it('ranks a stronger kind above an earlier position', () => {
    // `ORDER` is exact; `ORDERS_ARCHIVE` is a prefix match starting at the same index.
    // Kind has to dominate position or the ordering is unexplainable.
    expect(rank('order', ['ORDERS_ARCHIVE', 'ORDER'])).toEqual(['ORDER', 'ORDERS_ARCHIVE'])
  })

  it('ranks prefix above acronym above substring above subsequence', () => {
    // The whole tier order in one assertion. `c_u_s_of_t` is an acronym match because
    // every one of c/u/s/t starts a word; `legacy_cust_map` merely contains the letters
    // together; `checkout_summary_target` merely contains them in order.
    expect(
      rank('cust', [
        'legacy_cust_map',
        'checkout_summary_target',
        'customer',
        'c_u_s_of_t',
      ]),
    ).toEqual(['customer', 'c_u_s_of_t', 'legacy_cust_map', 'checkout_summary_target'])
  })

  describe('acronyms', () => {
    it('matches word starts across separators', () => {
      expect(kindOf('col', 'customer_order_line')).toBe('acronym')
      expect(kindOf('col', 'customer-order-line')).toBe('acronym')
      expect(kindOf('col', 'customer.order.line')).toBe('acronym')
    })

    it('matches camelCase word starts', () => {
      expect(kindOf('sa', 'shippedAt')).toBe('acronym')
      expect(kindOf('cid', 'customerIdentityDocument')).toBe('acronym')
    })

    it('beats a substring match, because it spells out the structure', () => {
      // `col` appears literally inside `decolour_code`, and is the acronym of the other.
      // The acronym is the stronger signal of intent.
      expect(rank('col', ['decolour_code', 'customer_order_line'])[0]).toBe('customer_order_line')
    })

    it('but a prefix still wins, because the user typed the start of the name', () => {
      // `col` IS the start of `colour_code`, and someone typing it almost certainly means
      // that rather than an acronym of three other words.
      expect(rank('col', ['colour_code', 'customer_order_line'])[0]).toBe('colour_code')
    })

    it('does not fire for a single character', () => {
      // Every name starts a word, so a one-character acronym would match nearly
      // everything and rank it above real substring hits. A single character is whatever
      // it plainly is — the start of the name, or a letter somewhere inside it.
      expect(kindOf('c', 'customer_order')).toBe('prefix')
      expect(kindOf('o', 'customer_order')).toBe('substring')
      // `o` starts the word `order`, which is exactly what an acronym match would claim.
      expect(kindOf('o', 'customer_order')).not.toBe('acronym')
    })
  })

  describe('match positions, which is what gets highlighted', () => {
    it('reports the matched indices for a substring', () => {
      expect(fuzzyMatch('line', 'ORDER_LINE')?.positions).toEqual([6, 7, 8, 9])
    })

    it('reports word starts for an acronym', () => {
      expect(fuzzyMatch('col', 'customer_order_line')?.positions).toEqual([0, 9, 15])
    })

    it('prefers a later word start to an earlier mid-word character', () => {
      /*
       * The one piece of cleverness in the subsequence branch, and the reason it is not a
       * plain greedy scan. In `customer_identity`, a greedy match for `cid` takes the `i`
       * and `d` from inside "customer"/"identity" wherever they first appear; preferring
       * a boundary puts them on the words the user was actually spelling, so the
       * highlight reads as `Customer_IDentity` rather than as three scattered letters.
       */
      const greedyWouldBe = [0, 6, 13]
      const positions = fuzzyMatch('cid', 'customer_identity')?.positions
      expect(positions).not.toEqual(greedyWouldBe)
      expect(positions?.[0]).toBe(0)
      // The `i` lands on the start of "identity", not the one in "customer".
      expect(positions?.[1]).toBe(9)
    })

    it('returns ascending, in-range indices for every kind', () => {
      const candidate = 'customer_order_line'
      for (const query of ['customer_order_line', 'cust', 'col', 'order', 'cole']) {
        const match = fuzzyMatch(query, candidate)
        expect(match, query).toBeDefined()
        const positions = match!.positions
        expect(positions.length, query).toBe(query.length)
        for (let index = 1; index < positions.length; index++) {
          expect(positions[index]!, query).toBeGreaterThan(positions[index - 1]!)
        }
        expect(Math.max(...positions), query).toBeLessThan(candidate.length)
      }
    })
  })

  it('stays fast enough for the 300-entity ceiling', () => {
    /*
     * NOT a wall-clock budget — this project keeps those in `pnpm test:perf` on purpose
     * (see NEXT.md). This asserts the SHAPE of the cost: matching is a single pass per
     * candidate, so 5,000 candidates is 5,000 passes and nothing quadratic hides in it.
     * The generous ceiling is there to catch an accidental O(n^2), not to benchmark.
     */
    const corpus = Array.from({ length: 5_000 }, (_, index) => `customer_order_line_${String(index)}`)
    const started = performance.now()
    const hits = corpus.filter((candidate) => fuzzyMatch('col', candidate) !== undefined)
    expect(hits.length).toBe(5_000)
    expect(performance.now() - started).toBeLessThan(500)
  })
})
