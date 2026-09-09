/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  CommandStack,
  addEntity,
  createDiagram,
  createEntity,
  moveEntities,
  renameEntity,
  type Diagram,
  type EntityId,
} from '../../../src/domain'

/** Deterministic clock so coalescing windows are testable without timers. */
function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let value = start
  return {
    now: () => value,
    advance: (ms) => {
      value += ms
    },
  }
}

describe('CommandStack — basic history', () => {
  let stack: CommandStack
  let base: Diagram

  beforeEach(() => {
    base = createDiagram({ name: 'Test' })
    stack = new CommandStack(base)
  })

  it('starts with nothing to undo or redo', () => {
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
    expect(stack.state).toBe(base)
  })

  it('applies a command and records one step', () => {
    stack.execute(addEntity(createEntity({ name: 'CUSTOMER' })))

    expect(stack.state.entities).toHaveLength(1)
    expect(stack.depth).toBe(1)
    expect(stack.canUndo).toBe(true)
  })

  it('never mutates the previous state', () => {
    const before = stack.state
    stack.execute(addEntity(createEntity({ name: 'CUSTOMER' })))

    expect(before.entities).toHaveLength(0)
    expect(stack.state).not.toBe(before)
  })

  it('undo restores the exact previous document', () => {
    const before = stack.state
    stack.execute(addEntity(createEntity({ name: 'CUSTOMER' })))
    stack.undo()

    expect(stack.state).toEqual(before)
  })

  it('redo reapplies', () => {
    stack.execute(addEntity(createEntity({ name: 'CUSTOMER' })))
    const after = stack.state
    stack.undo()
    stack.redo()

    expect(stack.state).toEqual(after)
  })

  it('round-trips a long edit sequence back to the starting document', () => {
    const before = stack.state
    const entity = createEntity({ name: 'A' })
    stack.execute(addEntity(entity))
    stack.execute(renameEntity(entity.id, 'B'))
    stack.execute(renameEntity(entity.id, 'C'))
    stack.execute(addEntity(createEntity({ name: 'D' })))

    while (stack.canUndo) stack.undo()

    expect(stack.state).toEqual(before)
  })

  it('a new command clears the redo branch', () => {
    stack.execute(addEntity(createEntity({ name: 'A' })))
    stack.undo()
    expect(stack.canRedo).toBe(true)

    stack.execute(addEntity(createEntity({ name: 'B' })))

    expect(stack.canRedo).toBe(false)
  })

  it('undo and redo are no-ops at the ends rather than errors', () => {
    expect(() => stack.undo()).not.toThrow()
    expect(() => stack.redo()).not.toThrow()
    expect(stack.state).toEqual(base)
  })

  it('exposes labels for the undo/redo affordances', () => {
    stack.execute(addEntity(createEntity({ name: 'A' })))

    expect(stack.snapshot().undoLabel).toBe('Add entity')
    stack.undo()
    expect(stack.snapshot().redoLabel).toBe('Add entity')
  })
})

describe('CommandStack — no-op suppression', () => {
  it('records nothing when a command changes nothing', () => {
    const entity = createEntity({ name: 'CUSTOMER' })
    const stack = new CommandStack(createDiagram({ entities: [entity] }))

    stack.execute(renameEntity(entity.id, 'CUSTOMER'))

    // Without suppression this would leave an undo step that visibly does nothing.
    expect(stack.depth).toBe(0)
    expect(stack.canUndo).toBe(false)
  })

  it('records nothing when the target does not exist', () => {
    const stack = new CommandStack(createDiagram())

    stack.execute(renameEntity('ent_ghost' as EntityId, 'X'))

    expect(stack.depth).toBe(0)
  })

  it('still records when only one field changed', () => {
    const entity = createEntity({ name: 'CUSTOMER' })
    const stack = new CommandStack(createDiagram({ entities: [entity] }))

    stack.execute(renameEntity(entity.id, 'CLIENT'))

    expect(stack.depth).toBe(1)
  })
})

describe('CommandStack — coalescing', () => {
  it('merges consecutive renames of the same entity into one step', () => {
    const time = clock()
    const entity = createEntity({ name: '' })
    const stack = new CommandStack(createDiagram({ entities: [entity] }), { now: time.now })

    for (const name of ['C', 'CU', 'CUS', 'CUST']) {
      stack.execute(renameEntity(entity.id, name))
      time.advance(30)
    }

    expect(stack.state.entities[0]?.name).toBe('CUST')
    expect(stack.depth).toBe(1)
  })

  it('a single undo reverses the whole merged run', () => {
    const time = clock()
    const entity = createEntity({ name: 'ORIGINAL' })
    const stack = new CommandStack(createDiagram({ entities: [entity] }), { now: time.now })

    for (const name of ['O', 'OR', 'ORD']) {
      stack.execute(renameEntity(entity.id, name))
      time.advance(30)
    }
    stack.undo()

    // The merged inverse must run newest-first; if the order were wrong this would
    // land on an intermediate value instead of the original.
    expect(stack.state.entities[0]?.name).toBe('ORIGINAL')
  })

  it('does not merge across the coalescing window', () => {
    const time = clock()
    const entity = createEntity({ name: '' })
    const stack = new CommandStack(createDiagram({ entities: [entity] }), {
      now: time.now,
      coalesceWindowMs: 500,
    })

    stack.execute(renameEntity(entity.id, 'A'))
    time.advance(1_000)
    stack.execute(renameEntity(entity.id, 'AB'))

    expect(stack.depth).toBe(2)
  })

  it('does not merge edits to different entities', () => {
    const time = clock()
    const first = createEntity({ name: 'A' })
    const second = createEntity({ name: 'B' })
    const stack = new CommandStack(createDiagram({ entities: [first, second] }), { now: time.now })

    stack.execute(renameEntity(first.id, 'A1'))
    time.advance(10)
    stack.execute(renameEntity(second.id, 'B1'))

    expect(stack.depth).toBe(2)
  })

  it('collapses a drag gesture to one step and restores the start position', () => {
    const time = clock()
    const entity = createEntity({ name: 'A' })
    const stack = new CommandStack(createDiagram({ entities: [entity] }), { now: time.now })

    stack.execute(moveEntities({ [entity.id]: { x: 0, y: 0 } }))
    time.advance(10)
    for (let step = 1; step <= 60; step += 1) {
      stack.execute(moveEntities({ [entity.id]: { x: step * 3, y: step } }))
      time.advance(10)
    }

    expect(stack.state.layout.positions[entity.id]).toEqual({ x: 180, y: 60 })
    expect(stack.depth).toBe(1)

    stack.undo()
    expect(stack.state.layout.positions[entity.id]).toBeUndefined()
  })

  it('treats moving a different selection as a separate step', () => {
    const time = clock()
    const a = createEntity({ name: 'A' })
    const b = createEntity({ name: 'B' })
    const stack = new CommandStack(createDiagram({ entities: [a, b] }), { now: time.now })

    stack.execute(moveEntities({ [a.id]: { x: 1, y: 1 } }))
    time.advance(10)
    stack.execute(moveEntities({ [b.id]: { x: 2, y: 2 } }))

    expect(stack.depth).toBe(2)
  })
})

describe('CommandStack — transactions', () => {
  it('applies several commands as one undo step', () => {
    const stack = new CommandStack(createDiagram())
    const a = createEntity({ name: 'A' })
    const b = createEntity({ name: 'B' })

    stack.transaction('Import', [addEntity(a), addEntity(b), renameEntity(a.id, 'A2')])

    expect(stack.state.entities).toHaveLength(2)
    expect(stack.depth).toBe(1)
  })

  it('one undo reverses the entire transaction', () => {
    const stack = new CommandStack(createDiagram())
    const before = stack.state

    stack.transaction('Import', [addEntity(createEntity()), addEntity(createEntity())])
    stack.undo()

    expect(stack.state).toEqual(before)
  })

  it('an empty transaction records nothing', () => {
    const stack = new CommandStack(createDiagram())

    stack.transaction('Nothing to do', [])

    expect(stack.depth).toBe(0)
  })

  it('uses the transaction label rather than the last command\u2019s', () => {
    const stack = new CommandStack(createDiagram())

    stack.transaction('Import schema', [addEntity(createEntity())])

    expect(stack.snapshot().undoLabel).toBe('Import schema')
  })
})

describe('CommandStack — history limit (FR-7.1)', () => {
  it('keeps at least 100 steps by default', () => {
    const stack = new CommandStack(createDiagram())
    for (let index = 0; index < 150; index += 1) {
      stack.execute(addEntity(createEntity({ name: `E${String(index)}` })))
    }

    expect(stack.depth).toBe(100)
  })

  it('trims the oldest steps, leaving the document intact', () => {
    const stack = new CommandStack(createDiagram(), { limit: 3 })
    for (let index = 0; index < 5; index += 1) {
      stack.execute(addEntity(createEntity({ name: `E${String(index)}` })))
    }

    expect(stack.state.entities).toHaveLength(5)
    expect(stack.depth).toBe(3)

    while (stack.canUndo) stack.undo()

    // Only the retained steps can be reversed; the first two entities stay.
    expect(stack.state.entities.map((entity) => entity.name)).toEqual(['E0', 'E1'])
  })
})

describe('CommandStack — reset', () => {
  it('replaces the document and discards history', () => {
    const stack = new CommandStack(createDiagram({ name: 'First' }))
    stack.execute(addEntity(createEntity()))

    const opened = createDiagram({ name: 'Second' })
    stack.reset(opened)

    expect(stack.state).toBe(opened)
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
  })
})

describe('CommandStack — updatedAt', () => {
  it('stamps updatedAt on every recorded edit', () => {
    const time = clock(Date.parse('2026-01-01T00:00:00.000Z'))
    const stack = new CommandStack(createDiagram(), { now: time.now })
    time.advance(60_000)

    stack.execute(addEntity(createEntity()))

    expect(stack.state.updatedAt).toBe('2026-01-01T00:01:00.000Z')
  })

  it('undo restores the previous updatedAt too', () => {
    const time = clock(Date.parse('2026-01-01T00:00:00.000Z'))
    const stack = new CommandStack(createDiagram(), { now: time.now })
    const before = stack.state.updatedAt

    time.advance(60_000)
    stack.execute(addEntity(createEntity()))
    stack.undo()

    expect(stack.state.updatedAt).toBe(before)
  })
})
