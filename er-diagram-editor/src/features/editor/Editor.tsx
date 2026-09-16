// Canvas shell: binds the stores to the renderer and owns the keyboard map.

import { useCallback, useEffect, useMemo } from 'react'

import {
  addAttribute,
  addEntity,
  addRelationship,
  applyMerge,
  copyEntities,
  isolate,
  PASTE_OFFSET,
  pasteEntities,
  planPaste,
  createAttribute,
  createEntity,
  createRelationship,
  deleteEntity,
  deleteRelationship,
  moveEntities,
  renameAttribute,
  renameDiagram,
  renameEntity,
  type AttributeId,
  type Command,
  type EntityId,
  type Point,
  type RelationshipId,
} from '../../domain'
import { formatChord, isMacPlatform, type LodLevel } from '../../lib'
import { measureEntity } from '../../layout'
import { Canvas, EditorActionsProvider, type EditorActions } from '../../render'
import { DiagramMenu, useDiagramLibrary } from '../diagram-manager'
import { ExportDialog } from '../export'
import { ImportDialog } from '../import'
import { InspectorPanel } from '../inspector'
import { CommandPalette, type PaletteCommand } from '../search'
import { ValidationPanel, ValidationToggle, useValidationReport } from '../validation-panel'

import { THEME_OPTIONS, useApplyTheme } from './useApplyTheme'
import {
  useClipboardStore,
  useDiagramStore,
  useSelectionStore,
  useUiStore,
  useViewportStore,
  viewportCenter,
} from '../../store'

import { EmptyState } from './EmptyState'
import { buildConnectCommands } from './connect'
import { placeNewEntity } from './placement'
import { useAutoLayout } from './useAutoLayout'
import { ShortcutsDialog } from './ShortcutsDialog'
import { SnapToggle } from './SnapToggle'
import { Toolbar } from './Toolbar'
import { ISOLATE_DEPTHS, isolateLabel } from './isolateOptions'
import { EDITOR_SHORTCUTS, findShortcut, isTypingTarget, type ShortcutId } from './shortcuts'
import { useSnapToGrid } from './useSnapToGrid'
import { buildSampleDiagram } from './sample'

/**
 * The four Detail choices, as palette commands (FR-9.2).
 *
 * The labels match `LOD_LABEL` in Toolbar.tsx, which is the list a user has already seen.
 * `undefined` is "Follow zoom" — the same value the select writes for its `auto` option.
 */
const LOD_COMMANDS: { value: LodLevel | undefined; label: string }[] = [
  { value: undefined, label: 'Follow zoom' },
  { value: 0, label: 'Names' },
  { value: 1, label: 'Keys' },
  { value: 2, label: 'All fields' },
]

export function Editor(): React.ReactElement {
  // Each subscription is a narrow selector rather than the whole store. Taking the whole
  // object would re-render this component on every hover, undoing the store split.
  const diagram = useDiagramStore((state) => state.diagram)
  const history = useDiagramStore((state) => state.history)
  const isDirty = useDiagramStore((state) => state.isDirty)
  const saveError = useDiagramStore((state) => state.saveError)
  const execute = useDiagramStore((state) => state.execute)
  const transaction = useDiagramStore((state) => state.transaction)
  const undo = useDiagramStore((state) => state.undo)
  const redo = useDiagramStore((state) => state.redo)
  const load = useDiagramStore((state) => state.load)

  const selectedEntityIds = useSelectionStore((state) => state.selectedEntityIds)
  const selectedRelationshipIds = useSelectionStore((state) => state.selectedRelationshipIds)
  const selectedAttributeId = useSelectionStore((state) => state.selectedAttributeId)
  const selectRelationships = useSelectionStore((state) => state.selectRelationships)
  const selectAttribute = useSelectionStore((state) => state.selectAttribute)
  const hoveredEntityId = useSelectionStore((state) => state.hoveredEntityId)
  const hoveredRelationshipId = useSelectionStore((state) => state.hoveredRelationshipId)
  const selectEntities = useSelectionStore((state) => state.selectEntities)
  const setHoveredEntity = useSelectionStore((state) => state.setHoveredEntity)
  const setHoveredRelationship = useSelectionStore((state) => state.setHoveredRelationship)
  const reconcile = useSelectionStore((state) => state.reconcile)

  const clipboardPayload = useClipboardStore((state) => state.payload)
  const pasteCount = useClipboardStore((state) => state.pasteCount)
  const copyToClipboard = useClipboardStore((state) => state.copy)
  const notePasted = useClipboardStore((state) => state.notePasted)

  const isolateDepth = useViewportStore((state) => state.isolateDepth)
  const setIsolateDepth = useViewportStore((state) => state.setIsolateDepth)
  const revealEntities = useViewportStore((state) => state.revealEntities)
  const lod = useViewportStore((state) => state.lod)
  const lodOverride = useViewportStore((state) => state.lodOverride)
  const setLodOverride = useViewportStore((state) => state.setLodOverride)
  const setViewport = useViewportStore((state) => state.setViewport)
  const setPaneSize = useViewportStore((state) => state.setPaneSize)

  const revealRequest = useViewportStore((state) => state.revealRequest)

  const minimapOpen = useUiStore((state) => state.minimapOpen)
  const validationPanelOpen = useUiStore((state) => state.validationPanelOpen)
  const toggleValidationPanel = useUiStore((state) => state.toggleValidationPanel)
  const activeDialog = useUiStore((state) => state.activeDialog)
  const openDialog = useUiStore((state) => state.openDialog)
  const closeDialog = useUiStore((state) => state.closeDialog)

  // Cheap: memoised on the diagram object inside the validator, so this and the toolbar
  // badge and the panel all share one computation per edit.
  const validation = useValidationReport()

  // Selection can outlive what it points at — after a delete, and after an undo of an
  // add. Reconciling here keeps that in one place instead of at every call site.
  useEffect(() => {
    reconcile(
      new Set(diagram.entities.map((entity) => entity.id)),
      new Set(diagram.relationships.map((relationship) => relationship.id)),
    )
  }, [diagram, reconcile])

  /**
   * Add an entity where the user is looking (FR-1.1), rather than at a grid slot.
   *
   * Both stores are read imperatively with `getState()` here instead of through the
   * selectors above, and that is deliberate on two counts.
   *
   * The viewport: subscribing to `x`/`y`/`zoom` would re-render this component — and so
   * re-run the canvas's node and edge memos — on every frame of every pan, which is the
   * exact cost that splitting the viewport out of the model store exists to avoid.
   *
   * The positions: they change on every frame of every drag, so taking them as a
   * dependency would rebuild this callback at pointer rate — and it is a dependency of
   * the keymap effect below, so the window listener would be torn down and re-added with
   * it. Both values are needed only at the instant of the click, so both are read then.
   */
  const handleAddEntity = useCallback(() => {
    const current = useDiagramStore.getState().diagram
    const entity = createEntity({ name: `ENTITY_${String(current.entities.length + 1)}` })

    const position = placeNewEntity({
      center: viewportCenter(useViewportStore.getState()),
      // A brand-new entity has no attributes, so this is the same size at every level of
      // detail. Passing the level the user is on anyway keeps it correct if that changes.
      size: measureEntity(entity, lodOverride ?? lod),
      taken: Object.values(current.layout.positions),
    })

    execute(addEntity(entity, position))
    selectEntities([entity.id])
  }, [lod, lodOverride, execute, selectEntities])

  const handleAddRelationship = useCallback(() => {
    const [from, to] = [...selectedEntityIds]
    if (from === undefined || to === undefined) return
    execute(addRelationship(createRelationship({ from, to })))
  }, [execute, selectedEntityIds])

  const handleDeleteSelection = useCallback(() => {
    const relationshipIds = [...selectedRelationshipIds]
    if (relationshipIds.length > 0) {
      transaction(
        'Delete relationship',
        relationshipIds.map((id) => deleteRelationship(id)),
      )
      return
    }

    const ids = [...selectedEntityIds]
    if (ids.length === 0) return

    // One undo step for the whole selection, not one per entity (FR-7.1).
    const commands: Command[] = ids.map((id) => deleteEntity(id))
    transaction(ids.length === 1 ? 'Delete entity' : 'Delete entities', commands)
  }, [selectedEntityIds, selectedRelationshipIds, transaction])

  /*
   * Copy / cut / paste / duplicate (FR-7.4).
   *
   * The clipboard holds a PAYLOAD rather than a set of ids, so it survives the entities it
   * was filled from being deleted — which is exactly what cut does a line later.
   */
  const handleCopy = useCallback((): boolean => {
    if (selectedEntityIds.size === 0) return false
    copyToClipboard(copyEntities(diagram, selectedEntityIds))
    return true
  }, [diagram, selectedEntityIds, copyToClipboard])

  const handleCut = useCallback(() => {
    // Copy first: after the delete there is nothing left to read.
    if (handleCopy()) handleDeleteSelection()
  }, [handleCopy, handleDeleteSelection])

  const handlePaste = useCallback(() => {
    if (clipboardPayload === undefined || clipboardPayload.entities.length === 0) return

    // Each paste of the same payload steps one offset further out. Without it the second
    // Ctrl+V lands exactly on the first and reads as nothing having happened.
    const step = pasteCount + 1
    const result = planPaste(diagram, clipboardPayload, {
      x: PASTE_OFFSET.x * step,
      y: PASTE_OFFSET.y * step,
    })

    execute(pasteEntities(result))
    notePasted()
    selectEntities([...result.newEntityIds])
  }, [clipboardPayload, pasteCount, diagram, execute, notePasted, selectEntities])

  const handleDuplicate = useCallback(() => {
    if (selectedEntityIds.size === 0) return

    // Deliberately does NOT touch the clipboard — duplicating something should not cost you
    // whatever you had copied. Same plan, different word on the undo button.
    const result = planPaste(diagram, copyEntities(diagram, selectedEntityIds))
    execute(pasteEntities(result, 'Duplicate'))
    selectEntities([...result.newEntityIds])
  }, [diagram, selectedEntityIds, execute, selectEntities])

  /**
   * What the canvas may draw, when isolate mode is on (FR-2.8).
   *
   * `undefined` — draw everything — whenever the mode is off OR nothing is selected, and
   * the second half is the design decision. Isolate is defined relative to a selection, so
   * with nothing selected there is no centre for it; showing NOTHING would be the literal
   * reading and is a blank canvas, which is not a useful answer to having pressed Escape.
   * The toolbar says so rather than the canvas going empty.
   *
   * This is a VIEW, not an edit. The document in the store is untouched, so export,
   * validation, auto-layout and the file the user saves all still see the whole schema.
   */
  const isolation = useMemo(() => {
    if (isolateDepth === undefined || selectedEntityIds.size === 0) return undefined
    return isolate(diagram, [...selectedEntityIds], isolateDepth)
  }, [diagram, selectedEntityIds, isolateDepth])

  /**
   * Turn isolate on or off, and frame what is left.
   *
   * The camera move is done HERE, in the event handler, rather than in an effect watching
   * `isolation`. An effect would also fire every time the selection changed while the mode
   * was on, re-framing the canvas under someone who was only clicking about — and writing
   * to a store from an effect is the cascading-render shape CLAUDE.md records twice.
   *
   * It recomputes the isolation because the memo above is still on the OLD depth at this
   * point; the walk is a BFS over an in-memory index and happens once per click.
   */
  const handleSetIsolateDepth = useCallback(
    (depth: number | undefined) => {
      setIsolateDepth(depth)
      if (depth === undefined || selectedEntityIds.size === 0) return
      revealEntities([...isolate(diagram, [...selectedEntityIds], depth).entityIds])
    },
    [setIsolateDepth, revealEntities, diagram, selectedEntityIds],
  )

  const handleMove = useCallback(
    (positions: Record<EntityId, Point>) => {
      execute(moveEntities(positions))
    },
    [execute],
  )

  const handleSelect = useCallback(
    (ids: EntityId[], additive: boolean) => {
      selectEntities(ids, additive)
    },
    [selectEntities],
  )

  /**
   * Drag from one entity to another (FR-1.4).
   *
   * Both the relationship and any foreign key go in one transaction, so a single undo
   * reverses the whole gesture. The command-building itself lives in `connect.ts` where
   * it can be tested without a pointer drag.
   */
  const handleConnect = useCallback(
    (source: EntityId, target: EntityId, sourceAttributeId: AttributeId | undefined) => {
      transaction(
        'Add relationship',
        buildConnectCommands(diagram, source, target, sourceAttributeId),
      )
    },
    [diagram, transaction],
  )

  const handleSelectRelationship = useCallback(
    (id: RelationshipId) => {
      selectRelationships([id])
    },
    [selectRelationships],
  )

  /**
   * Callbacks handed to the canvas through context.
   *
   * Memoised as one object with stable identities so a keystroke in one node does not
   * invalidate `node.data` for the other 119 — see the note in EditorActions.tsx.
   */
  const editorActions = useMemo<EditorActions>(
    () => ({
      renameEntity: (entityId, name) => {
        execute(renameEntity(entityId, name))
      },
      addAttribute: (entityId) => {
        const created = createAttribute()
        execute(addAttribute(entityId, created))
        selectEntities([entityId])
        selectAttribute(created.id)
      },
      renameAttribute: (entityId, attributeId, name) => {
        execute(renameAttribute(entityId, attributeId, name))
      },
      selectAttribute: (entityId, attributeId: AttributeId) => {
        selectEntities([entityId])
        selectAttribute(attributeId)
      },
    }),
    [execute, selectEntities, selectAttribute],
  )

  /**
   * What each shortcut id actually does (NFR-3.2).
   *
   * Typed as `Record<ShortcutId, …>`, which is the point: `shortcuts.ts` owns the list of
   * commands and this owns their behaviour, and neither can gain an entry the other does
   * not have without a type error. A sheet that promises a key nothing is bound to is the
   * failure this shape exists to make impossible.
   */
  const shortcutHandlers = useMemo<Record<ShortcutId, () => void>>(
    () => ({
      'add-entity': handleAddEntity,
      'add-relationship': handleAddRelationship,
      delete: handleDeleteSelection,
      copy: () => {
        handleCopy()
      },
      cut: handleCut,
      paste: handlePaste,
      duplicate: handleDuplicate,
      undo,
      redo,
      palette: () => {
        openDialog('palette')
      },
      shortcuts: () => {
        openDialog('shortcuts')
      },
      'clear-selection': () => {
        selectEntities([])
      },
    }),
    [
      handleAddEntity,
      handleAddRelationship,
      handleDeleteSelection,
      handleCopy,
      handleCut,
      handlePaste,
      handleDuplicate,
      undo,
      redo,
      openDialog,
      selectEntities,
    ],
  )

  // NFR-3.2: every mouse action is reachable by keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A modal dialog is modal for the keyboard too. `ui/Dialog` traps Tab, but a
      // window-level keydown listener sits outside anything a focus trap can reach — so
      // with the export dialog open, pressing `e` added an entity to the document behind
      // it and `Delete` deleted the selection out from under the preview the user was
      // reading.
      if (activeDialog !== undefined) return

      /*
       * One lookup, and the table decides everything the chain of `if`s used to.
       *
       * It used to be eleven branches in this function, with Ctrl+K hoisted above the
       * typing guard and the guard itself written out here. All three facts — which chord,
       * whether it survives a text field, whether it swallows the key — now travel with
       * the shortcut, which is also what the sheet renders. See `shortcuts.ts`.
       */
      const shortcut = findShortcut(event, isTypingTarget(event.target))
      if (shortcut?.id === undefined) return

      if (shortcut.preventDefault !== false) event.preventDefault()
      shortcutHandlers[shortcut.id]()
    }

    globalThis.addEventListener('keydown', onKeyDown)
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown)
    }
  }, [activeDialog, shortcutHandlers])

  const autoLayout = useAutoLayout({ diagram, lod: lodOverride ?? lod, execute })

  /*
   * Every command the toolbar offers, for the Ctrl+K palette (FR-9.2).
   *
   * Built HERE rather than in a registry inside `features/search`, because this component
   * already owns every handler and already computes every disabled condition for the
   * toolbar. A registry would be a second list to keep in step, and the failure mode is
   * silent: a command that is greyed out in one place and live in the other.
   *
   * The `disabled` flags are the same expressions the Toolbar uses, deliberately — read
   * them alongside `Toolbar.tsx` rather than re-deriving what ought to disable a command.
   */
  const applyTheme = useApplyTheme()
  const { snapToGrid, setSnapToGrid } = useSnapToGrid()

  /**
   * The key hint beside a palette command, taken from the keymap rather than retyped.
   *
   * These used to be string literals — `'E'`, `'Ctrl+Shift+Z'` — sitting next to a
   * keydown handler that tested for the real thing a hundred lines away. Nothing would
   * have failed if the two had disagreed; the palette would simply have taught the wrong
   * key. Now both come off the same `Chord`.
   */
  const mac = useMemo(() => isMacPlatform(), [])
  const hintFor = useCallback(
    (id: ShortcutId): string | undefined => {
      const chord = EDITOR_SHORTCUTS.find((candidate) => candidate.id === id)?.chords[0]
      return chord === undefined ? undefined : formatChord(chord, { mac })
    },
    [mac],
  )

  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'add-entity',
        label: 'Add entity',
        hint: hintFor('add-entity'),
        disabled: false,
        run: handleAddEntity,
      },
      {
        id: 'add-relationship',
        label: 'Add relationship',
        hint: hintFor('add-relationship'),
        disabled: selectedEntityIds.size !== 2,
        run: handleAddRelationship,
      },
      {
        id: 'delete',
        label: 'Delete selection',
        hint: hintFor('delete'),
        disabled: selectedEntityIds.size + selectedRelationshipIds.size === 0,
        run: handleDeleteSelection,
      },
      {
        id: 'undo',
        label: history.undoLabel === undefined ? 'Undo' : `Undo ${history.undoLabel}`,
        hint: hintFor('undo'),
        disabled: !history.canUndo,
        run: undo,
      },
      {
        id: 'redo',
        label: history.redoLabel === undefined ? 'Redo' : `Redo ${history.redoLabel}`,
        hint: hintFor('redo'),
        disabled: !history.canRedo,
        run: redo,
      },
      {
        id: 'auto-layout',
        label: 'Auto-layout',
        hint: undefined,
        disabled: autoLayout.isRunning || diagram.entities.length < 2,
        run: () => {
          void autoLayout.run()
        },
      },
      {
        id: 'import',
        label: 'Open file…',
        hint: undefined,
        disabled: false,
        run: () => {
          openDialog('import')
        },
      },
      {
        id: 'export',
        label: 'Export…',
        hint: undefined,
        disabled: false,
        run: () => {
          openDialog('export')
        },
      },
      ...[undefined, ...ISOLATE_DEPTHS].map((depth) => ({
        id: `isolate-${String(depth ?? 'off')}`,
        label: `Isolate: ${isolateLabel(depth)}`,
        hint: undefined,
        // "Off" is always available — it is the way out. The depths need a centre.
        disabled: isolateDepth === depth || (depth !== undefined && selectedEntityIds.size === 0),
        run: () => {
          handleSetIsolateDepth(depth)
        },
      })),
      {
        id: 'snap-to-grid',
        label: snapToGrid ? 'Snap to grid: off' : 'Snap to grid: on',
        hint: undefined,
        disabled: false,
        run: () => {
          setSnapToGrid(!snapToGrid)
        },
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        hint: hintFor('shortcuts'),
        disabled: false,
        run: () => {
          openDialog('shortcuts')
        },
      },
      {
        id: 'issues',
        label: validationPanelOpen ? 'Hide issues' : 'Show issues',
        hint: undefined,
        disabled: false,
        run: toggleValidationPanel,
      },
      // Detail is the highest-leverage control at 120 tables — it is what decides whether
      // a box draws its fields — so all four levels are commands rather than one toggle.
      ...LOD_COMMANDS.map((option) => ({
        id: `detail-${String(option.value ?? 'auto')}`,
        label: `Detail: ${option.label}`,
        hint: undefined,
        disabled: lodOverride === option.value,
        run: () => {
          setLodOverride(option.value)
        },
      })),
      ...THEME_OPTIONS.map((option) => ({
        id: `theme-${option.value}`,
        label: `Theme: ${option.label}`,
        hint: undefined,
        disabled: false,
        run: () => {
          applyTheme(option.value)
        },
      })),
    ],
    [
      hintFor,
      handleAddEntity,
      handleAddRelationship,
      handleDeleteSelection,
      selectedEntityIds.size,
      selectedRelationshipIds.size,
      history.canUndo,
      history.canRedo,
      history.undoLabel,
      history.redoLabel,
      undo,
      redo,
      autoLayout,
      diagram.entities.length,
      openDialog,
      validationPanelOpen,
      toggleValidationPanel,
      isolateDepth,
      handleSetIsolateDepth,
      snapToGrid,
      setSnapToGrid,
      lodOverride,
      setLodOverride,
      applyTheme,
    ],
  )
  const library = useDiagramLibrary(diagram.id)

  const diagramMenu = (
    <DiagramMenu
      name={diagram.name}
      currentId={diagram.id}
      saved={library.saved}
      onRename={(name) => {
        execute(renameDiagram(name))
      }}
      onNew={() => {
        // Selection belongs to the document that is going away.
        selectEntities([])
        load(library.createNew())
      }}
      onOpen={(id) => {
        void library.open(id).then((opened) => {
          if (opened === undefined) return
          selectEntities([])
          load(opened)
        })
      }}
      onDelete={(id) => {
        void library.remove(id)
      }}
    />
  )

  const effectiveLevel = useMemo(() => lodOverride ?? lod, [lodOverride, lod])
  const isEmpty = diagram.entities.length === 0
  const hasSelection = selectedEntityIds.size > 0 || selectedRelationshipIds.size > 0

  return (
    <div className="erd-shell">
      <Toolbar
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        undoLabel={history.undoLabel}
        redoLabel={history.redoLabel}
        entityCount={diagram.entities.length}
        selectedCount={selectedEntityIds.size + selectedRelationshipIds.size}
        selectedEntityCount={selectedEntityIds.size}
        lod={lod}
        lodOverride={lodOverride}
        isDirty={isDirty}
        saveError={saveError}
        onAddEntity={handleAddEntity}
        onAddRelationship={handleAddRelationship}
        onDeleteSelection={handleDeleteSelection}
        onUndo={undo}
        onRedo={redo}
        onSetLodOverride={setLodOverride}
        isolateDepth={isolateDepth}
        isolatedCount={isolation?.entityIds.size}
        onSetIsolateDepth={handleSetIsolateDepth}
        diagramMenu={diagramMenu}
        validationToggle={<ValidationToggle />}
        snapToggle={<SnapToggle />}
        onShowShortcuts={() => {
          openDialog('shortcuts')
        }}
        onExport={() => {
          openDialog('export')
        }}
        onImport={() => {
          openDialog('import')
        }}
        onAutoLayout={() => {
          void autoLayout.run()
        }}
        isLayingOut={autoLayout.isRunning}
        layoutError={autoLayout.error}
      />

      <div className="erd-body">
        {/* Canvas and the problems strip share a column, so the strip sits under the
            drawing and the inspector stays full height beside both. */}
        <div className="erd-canvas-column">
          <main className="erd-main">
            {isEmpty ? (
              <EmptyState
                onAddEntity={handleAddEntity}
                onLoadSample={() => {
                  load(buildSampleDiagram())
                }}
              />
            ) : (
              <EditorActionsProvider value={editorActions}>
                <Canvas
                  diagram={diagram}
                  lod={effectiveLevel}
                  hoveredEntityId={hoveredEntityId}
                  hoveredRelationshipId={hoveredRelationshipId}
                  selectedEntityIds={selectedEntityIds}
                  selectedRelationshipIds={selectedRelationshipIds}
                  selectedAttributeId={selectedAttributeId}
                  editable
                  onHoverEntity={setHoveredEntity}
                  onHoverRelationship={setHoveredRelationship}
                  onSelectEntities={handleSelect}
                  onSelectRelationship={handleSelectRelationship}
                  onConnect={handleConnect}
                  onMoveEntities={handleMove}
                  onViewportChange={setViewport}
                  onPaneResize={setPaneSize}
                  snapToGrid={snapToGrid}
                  isolation={isolation}
                  showMinimap={minimapOpen}
                  issueSeverityByEntity={validation.severityByEntity}
                  issueSeverityByRelationship={validation.severityByRelationship}
                  revealRequest={revealRequest}
                />
              </EditorActionsProvider>
            )}
          </main>

          {/* Collapsed by default: a permanently open problems list on a half-finished
              diagram is a wall of warnings about work in progress. The badge on the
              toggle is the part that is always visible (FR-8.4). */}
          {isEmpty || !validationPanelOpen ? null : (
            <ValidationPanel onClose={toggleValidationPanel} />
          )}
        </div>

        {/* The panel appears only when there is something to edit. 288px of "select
            something" permanently narrows the canvas, which is the thing the user is
            actually here to look at. */}
        {isEmpty || !hasSelection ? null : <InspectorPanel />}
      </div>

      {activeDialog === 'palette' ? (
        <CommandPalette diagram={diagram} commands={paletteCommands} onClose={closeDialog} />
      ) : null}

      {activeDialog === 'shortcuts' ? <ShortcutsDialog onClose={closeDialog} /> : null}

      {activeDialog === 'export' ? <ExportDialog diagram={diagram} onClose={closeDialog} /> : null}

      {activeDialog === 'import' ? (
        <ImportDialog
          current={diagram}
          onClose={closeDialog}
          onMerged={(result) => {
            // Merging keeps the document, so the selection is only cleared because the
            // entities it names may have just been removed by the merge.
            selectEntities([])
            execute(applyMerge(result))
            closeDialog()
            // Deliberately NO auto-layout. Re-running it would rearrange every box, which
            // is the exact work this path exists to preserve; `mergeDiagrams` has already
            // placed the new tables clear of the existing ones.
          }}
          onImported={(imported, arrange) => {
            // Opens as a NEW document rather than replacing the current one, so the work
            // already on screen stays in the diagram list rather than being overwritten.
            selectEntities([])
            load(imported)
            closeDialog()
            // .mmd and .sql carry no coordinates, so an imported diagram would otherwise
            // land on the placeholder grid.
            //
            // `imported` is passed explicitly. `load` has updated the store by now, but
            // `autoLayout.run` reads the `diagram` PROP, which is still the pre-import
            // render's — so without this it arranges the document being replaced. See
            // `UseAutoLayoutRequest`.
            if (arrange) void autoLayout.run({ diagram: imported })
          }}
        />
      ) : null}
    </div>
  )
}
