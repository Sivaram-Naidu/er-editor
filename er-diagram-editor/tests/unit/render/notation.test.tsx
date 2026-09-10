/**
 * @vitest-environment jsdom
 *
 * Renders the notation glyphs as SVG. The suite default is `node` (see the note in vite.config.ts), so a file that
 * mounts anything has to opt back up here.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createAttribute } from '../../../src/domain'
import {
  CrowsFootMarkers,
  compactBadges,
  describeEnd,
  effectiveLod,
  entityLod,
  markerFor,
  tracedMarkerId,
} from '../../../src/render'

describe('compact notation badges (FR-5.2)', () => {
  it('gives a plain attribute no badges', () => {
    expect(compactBadges(createAttribute({ name: 'email' }))).toEqual([])
  })

  it('marks a primary key', () => {
    const badges = compactBadges(createAttribute({ name: 'id', isPrimaryKey: true }))

    expect(badges.map((badge) => badge.glyph)).toContain('PK')
  })

  it('prefers PK over UQ when both apply', () => {
    // A primary key is unique by definition; showing both is noise in a dense row.
    const badges = compactBadges(
      createAttribute({ name: 'id', isPrimaryKey: true, isUnique: true }),
    )

    expect(badges.map((badge) => badge.glyph)).toEqual(['PK'])
  })

  it('marks a unique non-key', () => {
    expect(
      compactBadges(createAttribute({ name: 'email', isUnique: true })).map((b) => b.glyph),
    ).toEqual(['UQ'])
  })

  it('carries all three Chen-only constructs (SRS §2.2)', () => {
    // The claim in SRS §2.2 is that compact mode loses no semantics — it re-encodes
    // them more densely. This is that claim, tested.
    const multivalued = compactBadges(createAttribute({ isMultivalued: true }))
    const derived = compactBadges(createAttribute({ isDerived: true }))
    const composite = compactBadges(createAttribute({ children: [createAttribute()] }))

    expect(multivalued.map((b) => b.label)).toContain('Multivalued')
    expect(derived.map((b) => b.label)).toContain('Derived')
    expect(composite.map((b) => b.label)).toContain('Composite')
  })

  it('keeps badge order stable so a column of rows reads as a column', () => {
    const badges = compactBadges({
      ...createAttribute({ name: 'x', isPrimaryKey: true, isMultivalued: true }),
      foreignKey: { entityId: 'ent_1' as never, attributeId: 'att_1' as never },
    })

    expect(badges.map((badge) => badge.glyph)).toEqual(['PK', 'FK', '⊞'])
  })

  it('gives every badge a text label for screen readers (NFR-4.4)', () => {
    const badges = compactBadges(createAttribute({ isPrimaryKey: true, isDerived: true }))

    expect(badges.every((badge) => badge.label.length > 0)).toBe(true)
  })
})

describe('crow\u2019s foot markers', () => {
  it('gives each cardinality/participation pair a distinct marker', () => {
    const ids = new Set([
      markerFor('one', 'total'),
      markerFor('one', 'partial'),
      markerFor('many', 'total'),
      markerFor('many', 'partial'),
    ])

    expect(ids.size).toBe(4)
  })
})

describe('describeEnd (FR-4.3)', () => {
  it.each([
    ['one', 'total', 'exactly one'],
    ['one', 'partial', 'at most one'],
    ['many', 'total', 'one or more'],
    ['many', 'partial', 'zero or more'],
  ] as const)('%s / %s reads as "%s"', (cardinality, participation, expected) => {
    expect(describeEnd(cardinality, participation)).toBe(expected)
  })
})

describe('effectiveLod (FR-2.7, FR-2.4)', () => {
  it('a pinned entity is always full detail, whatever the zoom', () => {
    expect(effectiveLod(0, true)).toBe(2)
    expect(effectiveLod(1, true)).toBe(2)
  })

  it('a pin beats even an explicit override', () => {
    // Pinning is a per-entity instruction; the override is a global default. The more
    // specific instruction wins, or pinning would appear broken whenever an override is set.
    expect(effectiveLod(0, true, 0)).toBe(2)
  })

  it('an override beats the zoom-derived level', () => {
    expect(effectiveLod(0, false, 2)).toBe(2)
    expect(effectiveLod(2, false, 0)).toBe(0)
  })

  it('falls through to the zoom-derived level', () => {
    expect(effectiveLod(1, false)).toBe(1)
  })

  it('entityLod composes the zoom mapping with the overrides', () => {
    expect(entityLod(0.2, false)).toBe(0)
    expect(entityLod(0.2, true)).toBe(2)
    expect(entityLod(1.5, false, 1)).toBe(1)
  })
})

describe('traced endpoint markers', () => {
  it('gives every glyph a distinct traced variant', () => {
    // Markers live in their own <svg>, so no CSS selector can reach them from the edge.
    // Without a second set the endpoints stay grey while the line turns blue, and the
    // trace visibly stops short of the glyph — the exact join the eye is following.
    const base = [
      markerFor('one', 'total'),
      markerFor('one', 'partial'),
      markerFor('many', 'total'),
      markerFor('many', 'partial'),
    ]
    const traced = base.map(tracedMarkerId)

    expect(new Set([...base, ...traced]).size).toBe(8)
    expect(traced.every((id, index) => id.startsWith(base[index]!))).toBe(true)
  })

  it('renders both a resting and a traced marker for each glyph', () => {
    const { container } = render(<CrowsFootMarkers />)
    const markers = [...container.querySelectorAll('marker')].map((marker) => marker.id)

    expect(markers).toHaveLength(8)
    expect(markers).toContain(markerFor('many', 'partial'))
    expect(markers).toContain(tracedMarkerId(markerFor('many', 'partial')))
  })
})
