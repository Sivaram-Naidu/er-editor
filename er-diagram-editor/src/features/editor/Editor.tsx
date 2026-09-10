// Canvas shell: binds the stores to the renderer and owns the keyboard map.

import { useCallback, useEffect, useMemo } from 'react'

import {
  addAttribute,
  addEntity,
  addRelationship,
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
import { measureEntity } from '../../layout'
import { Canvas, EditorActionsProvider, type EditorActions } from '../../render'
import { DiagramMenu, useDiagramLibrary } from '../diagram-manager'
import { ExportDialog } from '../export'
import { ImportDialog } from '../import'
import { InspectorPanel } from '../inspector'
import { ValidationPanel, ValidationToggle, useValidationReport } from '../validation-panel'
import {
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
import { Toolbar } from './Toolbar'
import { buildSampleDiagram } from './sample'

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

  // NFR-3.2: every mouse action is reachable by keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A modal dialog is modal for the keyboard too. `ui/Dialog` traps Tab, but a
      // window-level keydown listener sits outside anything a focus trap can reach — so
      // with the export dialog open, pressing `e` added an entity to the document behind
      // it and `Delete` deleted the selection out from under the preview the user was
      // reading.
      if (activeDialog !== undefined) return

      const target = event.target
      const isTyping =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (isTyping) return

      const modifier = event.ctrlKey || event.metaKey

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (!modifier && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        handleAddEntity()
        return
      }
      if (!modifier && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        handleAddRelationship()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        handleDeleteSelection()
        return
      }
      if (event.key === 'Escape') {
        selectEntities([])
      }
    }

    globalThis.addEventListener('keydown', onKeyDown)
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown)
    }
  }, [
    activeDialog,
    undo,
    redo,
    handleAddEntity,
    handleAddRelationship,
    handleDeleteSelection,
    selectEntities,
  ])

  const autoLayout = useAutoLayout({ diagram, lod: lodOverride ?? lod, execute })
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
        diagramMenu={diagramMenu}
        validationToggle={<ValidationToggle />}
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

      {activeDialog === 'export' ? <ExportDialog diagram={diagram} onClose={closeDialog} /> : null}

      {activeDialog === 'import' ? (
        <ImportDialog
          onClose={closeDialog}
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
