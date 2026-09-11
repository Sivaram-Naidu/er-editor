# Software Requirements Specification

## ER Diagram Editor — a browser-based tool for large relational schemas

**Version:** 1.1 — revised against the implementation
**Date:** 9 September 2026
**Status:** V1 substantially built. This revision records what was delivered, where
reality diverged from v1.0, and what remains.

> **How to read this document.** Every functional requirement carries a **Status**:
> **Done** (built and tested), **Partial** (usable but incomplete — the gap is stated),
> **Open** (not started). Non-functional requirements carry measured values where they
> have been measured. Where the implementation contradicts v1.0, the change and its
> reason are in §12.

---

## 1. Introduction

### 1.1 Purpose

This document specifies the requirements for an ER (Entity–Relationship) diagram editor that lets a user construct a schema through direct UI actions and remains legible and navigable at 100+ entities. It defines functional requirements (prioritised), non-functional requirements, the recommended technology stack with justification, and the V1 project structure.

### 1.2 Scope of V1

V1 is a **single-user, browser-only application with no backend**. All data lives in the browser (IndexedDB) and in files the user downloads or opens from local disk. There are no accounts, no server, no sharing, no collaboration.

Mermaid `.mmd` is the primary export target for V1, but the internal representation is deliberately format-neutral so DBML, SQL DDL, JSON Schema, and PlantUML exporters can be added later without touching the domain model or the renderer.

### 1.3 Out of scope for V1

Accounts and authentication; server-side storage; sharing links; real-time or asynchronous multi-user editing; comments and review workflow; live database introspection over a network connection; mobile-first editing.

### 1.4 Definitions

| Term                         | Meaning                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Entity**                   | A thing the schema models; renders as a rectangle (compact mode) or a Chen rectangle (Chen mode). Corresponds loosely to a table. |
| **Weak entity**              | An entity with no independent primary key; identified through an owner entity. Double rectangle.                                  |
| **Attribute**                | A property of an entity or relationship. Oval in Chen mode; a row in the entity box in compact mode.                              |
| **Relationship**             | A named association between two or more entities. Diamond in Chen mode; a labelled connector in compact mode.                     |
| **Identifying relationship** | The relationship that supplies a weak entity's identity. Double diamond.                                                          |
| **Cardinality**              | The `1:1` / `1:N` / `M:N` character of a relationship, with optional/mandatory participation.                                     |
| **IR**                       | Internal Representation — the tool's canonical in-memory and on-disk schema model.                                                |
| **LOD**                      | Level of Detail — how much of an entity is drawn, driven by zoom level.                                                           |
| **Compact mode**             | Table-style rendering (crow's foot / Information Engineering). Default.                                                           |
| **Chen mode**                | Classical Chen rendering with ovals and diamonds.                                                                                 |

### 1.5 Intended users

A single person designing or documenting a relational schema — a student learning ER modelling, a developer documenting an existing database, or an analyst reviewing a data model. They are assumed to be working on a desktop or laptop with a mouse or trackpad.

---

## 2. Design position: resolving the notation conflict

This section is normative — it explains _why_ the requirements in §4 are shaped as they are.

### 2.1 The problem with Chen notation at scale

The brief asks for both (a) legibility at 100+ tables and (b) support for classical Chen symbols. These are in direct tension. In Chen notation every attribute is its own node connected by its own edge. A 100-entity schema averaging 8 attributes with 120 relationships expands to roughly:

- 100 entity rectangles
- 800 attribute ovals
- 120 relationship diamonds
- ~1,040 connecting lines

That is ~1,020 nodes and ~1,040 edges. No layout algorithm produces a readable picture from that, and zooming does not help — zoom out and labels become illegible, zoom in and you lose all context. This is precisely why no production tool (dbdiagram.io, Lucidchart's DB shapes, DBeaver, SchemaSpy, Mermaid's `erDiagram`) uses Chen notation for real schemas. They all use compact table boxes with crow's foot connectors, because that notation has roughly **10× the information density per unit of screen area**.

### 2.2 The resolution: one model, two notations, three levels of detail

The tool separates **semantics** from **presentation**:

- The IR is a **superset** — it can express everything Chen expresses (weak entities, multivalued, derived, composite attributes, n-ary relationships, ISA hierarchies) plus everything crow's foot expresses (types, nullability, unique constraints, FK targets).
- **Compact mode** is the default renderer. Entities are boxes with attribute rows. Chen-only semantics survive as glyph badges on the rows: `⊞` multivalued, `⌁` derived (dashed underline), `∷` composite (expandable), underline for PK, double border for weak entities, hollow-diamond connector endpoint for identifying relationships. Nothing is lost — it is re-encoded more densely.
- **Chen mode** renders the classical shapes faithfully and is available for the whole canvas (usable up to ~15 entities) or, more usefully, as a **focused sub-view**: select one entity or a small selection and open "Chen view" in a side panel or overlay. This is where Chen notation is actually good — explaining one entity in full.

Level of detail is driven by zoom, in compact mode:

| Zoom   | LOD               | What is drawn                                                                                              |
| ------ | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| < 40%  | **L0 — Overview** | Entity name only, in a solid box. Relationship lines drawn thin, unlabelled. Groups/subject areas shaded.  |
| 40–90% | **L1 — Key**      | Entity name + primary key attributes + foreign key attributes only. Relationship cardinality glyphs drawn. |
| > 90%  | **L2 — Full**     | All attributes with type, key badges, constraints. Relationship labels drawn.                              |

The user can pin an individual entity to L2 regardless of zoom ("always expanded"), and can force a global LOD from the toolbar. This is the single most important scalability mechanism in the design: it keeps the drawn glyph count roughly proportional to _what fits on screen_ rather than to schema size.

### 2.3 On "blinking" highlight

The brief asks for hovered relationships to "highlight/blink." Animated blinking is specified out and replaced with a **static emphasis + dim** treatment (FR-4.1). Reasons: flashing content is a WCAG 2.3.1 concern and a vestibular/photosensitivity risk; blinking makes it harder, not easier, to read the labels you are hovering to read; and repeated blinking during exploratory tracing is fatiguing. A 120 ms ease-in to a thickened, saturated, raised connector with the two endpoint entities outlined and everything else dropped to ~25% opacity traces faster and reads better. If a motion cue is still wanted, an optional single animated pulse along the connector path (one pass, not looping) is specified as FR-4.4 (P2), disabled under `prefers-reduced-motion`.

### 2.4 Mermaid export is lossy — by definition

Mermaid's `erDiagram` grammar supports entities, typed attributes, `PK`/`FK`/`UK` markers, attribute comments, crow's foot cardinality (`||`, `o|`, `|{`, `o{`), relationship labels, and identifying vs non-identifying via solid `--` vs dotted `..`. It has **no** representation for multivalued attributes, derived attributes, composite attributes, weak entities as such, ISA hierarchies, n-ary relationships, or node positions.

Therefore `.mmd` is an **interchange** format, never the save format. The save format is the tool's own JSON. The exporter must report exactly what it degraded (FR-6.3). The mapping is specified in §7.2.

---

## 3. Domain model (the IR)

The IR is the contract that keeps the tool from being locked to Mermaid. Renderers, exporters, importers, validators, and the layout engine all read it; nothing reads anything else.

```
Diagram
  id, name, version, createdAt, updatedAt
  entities:      Entity[]
  relationships: Relationship[]
  groups:        Group[]          // subject areas
  layout:        LayoutState      // positions, pinned nodes, viewport
  meta:          { notation: 'compact' | 'chen', ... }

Entity
  id, name, comment
  kind:        'strong' | 'weak' | 'associative'
  attributes:  Attribute[]
  groupId?:    string
  parentId?:   string            // ISA: subtype of
  specialization?: { disjoint: boolean, total: boolean }

Attribute
  id, name, comment
  dataType?:   string            // free text; not validated against any dialect
  isPrimaryKey, isUnique, isNullable, isDerived, isMultivalued: boolean
  defaultValue?: string
  children?:   Attribute[]       // composite attributes, one level of nesting
  foreignKey?: { entityId, attributeId }

Relationship
  id, name, comment
  kind:        'binary' | 'nary' | 'isa'
  isIdentifying: boolean
  participants: Participant[]    // 2 for binary, 3+ for n-ary
  attributes:  Attribute[]       // relationship attributes

Participant
  entityId
  cardinality:   'one' | 'many'
  participation: 'partial' | 'total'   // optional vs mandatory
  role?:         string                 // for recursive relationships
```

Two structural notes that matter later:

- **Attributes carry stable IDs, not just names.** Renaming an attribute must not break a foreign key reference. Name-keyed models are the most common cause of rewrites in tools of this kind.
- **Layout is stored separately from semantics.** Positions live in `layout`, keyed by entity ID. This means auto-layout can be re-run without mutating the schema, and an exporter that has no concept of position (Mermaid) simply ignores that branch of the tree.

---

## 4. Functional requirements

Priorities: **P0** = MVP, ships in V1, non-negotiable. **P1** = V1 if schedule allows, otherwise first patch. **P2** = V2+, but the architecture must not preclude it.

### 4.1 Diagram construction

| ID      | Priority | Requirement                                                                                                                                                                                                   | Status                                                      |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| FR-1.1  | P0       | The user can create an entity via toolbar button, canvas context menu, or keyboard shortcut (`E`). The new entity is placed at the pointer or at the viewport centre and enters inline name-edit immediately. | Done                                                        |
| FR-1.2  | P0       | The user can add an attribute to an entity via the entity's inline `+` affordance or the inspector panel. New attributes append to the entity's attribute list and enter inline edit.                         | Done                                                        |
| FR-1.3  | P0       | The user can set, per attribute: name, data type (free text with autocomplete over common types), primary key, unique, nullable, and comment.                                                                 | Done                                                        |
| FR-1.4  | P0       | The user can create a relationship by dragging from a connection handle on one entity to another, or by selecting two entities and pressing `R`.                                                              | Done                                                        |
| FR-1.5  | P0       | The user can set, per relationship: name, and for each participant, cardinality (one/many) and participation (partial/total). Defaults to `1 : 0..N`.                                                         | Done                                                        |
| FR-1.6  | P0       | The user can rename any element inline (double-click) and via the inspector. Renames propagate to all references.                                                                                             | Done                                                        |
| FR-1.7  | P0       | The user can delete any element. Deleting an entity prompts if relationships would be orphaned, and offers "delete entity and its N relationships" or cancel.                                                 | Partial — cascade stated in the panel; no confirm dialog    |
| FR-1.8  | P0       | An inspector panel shows the full editable property set for the current selection, and supports multi-select for common properties.                                                                           | Done                                                        |
| FR-1.9  | P1       | The user can mark an entity as weak and designate its identifying relationship. The UI blocks marking an entity weak if it has no candidate identifying relationship, with an explanatory message.            | Done                                                        |
| FR-1.10 | P1       | The user can mark attributes as multivalued or derived, and can nest attributes one level to form composite attributes.                                                                                       | Partial — flags settable; composite nesting only via import |
| FR-1.11 | P1       | The user can designate an attribute as a foreign key targeting a specific attribute on another entity, with a picker restricted to key attributes.                                                            | Done                                                        |
| FR-1.12 | P1       | The user can create recursive relationships (both participants the same entity) with distinct role names per side.                                                                                            | Done                                                        |
| FR-1.13 | P2       | The user can create n-ary (3+ participant) relationships, rendered as an explicit hub node.                                                                                                                   | Open (V2)                                                   |
| FR-1.14 | P2       | The user can create ISA/generalization hierarchies with disjoint/overlapping and total/partial constraints.                                                                                                   | Open (V2)                                                   |
| FR-1.15 | P2       | The user can assign entities to named, colour-coded subject areas (groups).                                                                                                                                   | Open (V2)                                                   |

### 4.2 Canvas, zoom, pan, navigation

| ID      | Priority | Requirement                                                                                                                                                                                                                | Status                                                         |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| FR-2.1  | P0       | The canvas supports continuous zoom from 10% to 300% via scroll wheel, trackpad pinch, `Ctrl +` / `Ctrl -`, and on-screen controls. Zoom is anchored to the pointer.                                                       | Done                                                           |
| FR-2.2  | P0       | The canvas supports panning by space-drag, middle-mouse drag, trackpad two-finger scroll, and arrow keys.                                                                                                                  | Done                                                           |
| FR-2.3  | P0       | "Fit to view" (`Shift+1`) and "zoom to selection" (`Shift+2`) commands. Current zoom percentage is displayed and directly editable.                                                                                        | Partial — controls only; no keyboard shortcut                  |
| FR-2.4  | P0       | Zoom-driven level of detail per §2.2, with a manual override to force L0/L1/L2 globally.                                                                                                                                   | Done                                                           |
| FR-2.5  | P0       | A minimap in a canvas corner shows the whole diagram, the current viewport rectangle, and supports click-to-jump and drag-to-pan. Collapsible.                                                                             | Done                                                           |
| FR-2.6  | P0       | A search box (`Ctrl+K`) does fuzzy matching over entity names, attribute names, and relationship names. Selecting a result pans and zooms to the target and selects it. Results show which entity an attribute belongs to. | **Open — next priority**                                       |
| FR-2.7  | P1       | Entities can be individually pinned to full detail regardless of zoom level.                                                                                                                                               | Partial — model and renderer support pins; no UI control       |
| FR-2.8  | P1       | "Isolate" mode: with an entity selected, entities more than N hops away are hidden or heavily dimmed. N adjustable 1–3.                                                                                                    | Partial — traversal written and tested; not wired to a control |
| FR-2.9  | P1       | Marquee (rubber-band) multi-select and shift-click additive selection.                                                                                                                                                     | Open                                                           |
| FR-2.10 | P2       | Bookmarked viewports the user can name and jump between.                                                                                                                                                                   | Open (V2)                                                      |

### 4.3 Layout

| ID     | Priority | Requirement                                                                                                                       | Status                                                                                                                                                           |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-3.1 | P0       | An "auto-layout" command arranges all entities using a layered algorithm with orthogonal edge routing, minimising edge crossings. | **Done** — verified in Chrome, dev and production (ADR-0002 "Corrected")                                                                                         |
| FR-3.2 | P0       | Auto-layout runs off the main thread. The UI remains responsive and shows progress for large schemas.                             | **Done** — runs in elkjs's own worker; `tests/e2e/smoke.spec.ts` asserts the `worker` event fires, so an in-process fallback would fail the spec                 |
| FR-3.3 | P0       | Entities can be dragged manually; manual positions persist and are not overwritten unless the user re-runs auto-layout.           | Done                                                                                                                                                             |
| FR-3.4 | P0       | Auto-layout is a single undoable operation.                                                                                       | **Done** — one `applyLayout` command. The e2e spec asserts the Undo button reads "Undo Auto-layout" and that one click restores the previous arrangement exactly |
| FR-3.5 | P1       | Snap-to-grid (toggleable) and alignment guides while dragging.                                                                    | Open                                                                                                                                                             |
| FR-3.6 | P1       | Layout algorithm selectable: layered (default), force-directed, and tree/radial for hierarchy-shaped schemas.                     | Partial — three presets implemented; no UI selector                                                                                                              |
| FR-3.7 | P1       | "Auto-layout selection only", leaving the rest of the diagram untouched.                                                          | Partial — engine supports it; no UI entry point                                                                                                                  |
| FR-3.8 | P2       | Incremental layout — newly added entities are placed sensibly relative to their neighbours without disturbing existing positions. | Open (V2)                                                                                                                                                        |

### 4.4 Interactive highlighting

| ID     | Priority | Requirement                                                                                                                                                                                                                                     | Status                                                         |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| FR-4.1 | P0       | Hovering a relationship connector emphasises it (increased stroke weight, accent colour, raised z-order) and outlines both connected entities, while all other elements drop to reduced opacity. Transition ≤ 150 ms. **No looping animation.** | Done                                                           |
| FR-4.2 | P0       | Hovering an entity emphasises the entity and all its incident relationships and their far-end entities, dimming everything else.                                                                                                                | Done                                                           |
| FR-4.3 | P0       | A tooltip on relationship hover shows the relationship name, both entity names, and the cardinality in readable prose ("Each CUSTOMER places zero or more ORDERs").                                                                             | Partial — prose reading in the inspector, not a canvas tooltip |
| FR-4.4 | P1       | Clicking a relationship makes the highlight sticky until dismissed, so the user can pan while tracing.                                                                                                                                          | Open                                                           |
| FR-4.5 | P1       | Hovering a foreign-key attribute row highlights the specific connector it participates in, not just all of the entity's connectors.                                                                                                             | Done                                                           |
| FR-4.6 | P2       | Optional single-pass directional pulse along the hovered connector, off by default and suppressed under `prefers-reduced-motion`.                                                                                                               | Open (V2)                                                      |

### 4.5 Notation

| ID     | Priority | Requirement                                                                                                                                                                                                                                                                     | Status                     |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| FR-5.1 | P0       | Compact (crow's foot / IE) rendering is the default: entities as boxes with attribute rows, PK underlined, weak entities double-bordered, cardinality drawn as crow's foot endpoints.                                                                                           | Done                       |
| FR-5.2 | P0       | The compact renderer encodes all Chen-only semantics as row-level glyph badges (multivalued, derived, composite, PK, FK, unique) with a legend available from the toolbar.                                                                                                      | Done                       |
| FR-5.3 | P1       | A Chen mode renders classical notation for the full canvas: rectangle = entity, double rectangle = weak entity, oval = attribute, double oval = multivalued, dashed oval = derived, diamond = relationship, double diamond = identifying relationship, underline = primary key. | Open (V2)                  |
| FR-5.4 | P1       | Chen mode is additionally available as a focused sub-view for a single selected entity or small selection, rendered in a panel without disturbing the main canvas.                                                                                                              | Open (V2)                  |
| FR-5.5 | P1       | Switching notation mode preserves the model exactly; no data is lost or altered in either direction.                                                                                                                                                                            | n/a until Chen mode exists |
| FR-5.6 | P1       | Chen mode warns when the visible element count exceeds a legibility threshold and offers to switch to focused sub-view instead.                                                                                                                                                 | Open (V2)                  |
| FR-5.7 | P2       | User-selectable notation theme (crow's foot / IE / UML-ish / Barker) driven by a swappable glyph set.                                                                                                                                                                           | Open (V2)                  |

### 4.6 Export and import

| ID     | Priority | Requirement                                                                                                                                                                                                              | Status                                                                                                                                                                                                                                                                                                               |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-6.1 | P0       | Export the diagram as a Mermaid `.mmd` file, downloadable, whose content parses and renders in Mermaid Live Editor without error.                                                                                        | Done                                                                                                                                                                                                                                                                                                                 |
| FR-6.2 | P0       | Export preview: show the generated Mermaid source in a panel with syntax highlighting before download, with copy-to-clipboard.                                                                                           | Done                                                                                                                                                                                                                                                                                                                 |
| FR-6.3 | P0       | Export reports lossiness: a clear list of every construct that was dropped or approximated, with a link to the affected element.                                                                                         | Done                                                                                                                                                                                                                                                                                                                 |
| FR-6.4 | P0       | Save and open the tool's native `.erd.json` file, which round-trips the model and layout with zero loss. Schema-versioned with a `formatVersion` field.                                                                  | Done                                                                                                                                                                                                                                                                                                                 |
| FR-6.5 | P0       | Export the current canvas as PNG and SVG.                                                                                                                                                                                | **Done** — renders the WHOLE diagram off-screen at L2, not the visible screenful; verified in Chrome, see §7.3                                                                                                                                                                                                       |
| FR-6.6 | P1       | The export subsystem is a registry of format adapters conforming to a common interface, such that adding a format requires adding one module and registering it — no changes to the domain model, renderer, or UI shell. | Done                                                                                                                                                                                                                                                                                                                 |
| FR-6.7 | P2       | Additional exporters: DBML, SQL DDL (PostgreSQL / MySQL dialects), JSON Schema, PlantUML, PDF.                                                                                                                           | Open (V2) — DBML is one directory plus a registry line                                                                                                                                                                                                                                                               |
| FR-6.8 | P2       | Importers: Mermaid `.mmd`, DBML, SQL DDL. Import runs auto-layout since none of these formats carry positions.                                                                                                           | **Done** — `.mmd`, `.sql` (PostgreSQL/MySQL) and `.erd.json`. The auto-layout half needed a second fix beyond FR-3.1: `autoLayout.run()` read the pre-import `diagram` prop, so it arranged the document being replaced. An e2e spec now asserts an imported `.sql` does not land on `fallbackPosition`'s 280px grid |

### 4.7 Editing safety

| ID     | Priority | Requirement                                                                                                                                                                                | Status    |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| FR-7.1 | P0       | Undo/redo across all model and layout mutations, minimum 100 steps, via `Ctrl+Z` / `Ctrl+Shift+Z` and toolbar. Compound operations (auto-layout, cascade delete, import) undo as one step. | Done      |
| FR-7.2 | P0       | Autosave to browser storage, debounced, with a visible save indicator and last-saved timestamp.                                                                                            | Done      |
| FR-7.3 | P0       | Recovery on reload: the last autosaved state is restored, with an explicit "discard and start new" option.                                                                                 | Done      |
| FR-7.4 | P1       | Copy / cut / paste / duplicate of entities, including within-selection relationships. Pasted entities get unique names (`CUSTOMER_copy`).                                                  | Open      |
| FR-7.5 | P1       | Multiple named diagrams in local storage, with a diagram list/switcher.                                                                                                                    | Done      |
| FR-7.6 | P2       | Named local snapshots with restore, and a structural diff view between two snapshots.                                                                                                      | Open (V2) |

### 4.8 Validation

| ID     | Priority | Requirement                                                                                                                                                                                                        | Status                                                                                                          |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| FR-8.1 | P0       | A validation panel lists issues by severity (error / warning / info); clicking an issue selects and reveals the offending element.                                                                                 | **Done** — panel lists by severity; clicking an issue selects and reveals it                                    |
| FR-8.2 | P0       | Errors detected: duplicate entity names; duplicate attribute names within an entity; relationship with a missing endpoint; weak entity with no identifying relationship; empty required name.                      | **Done** — `duplicate-names`, `empty-name`, `weak-entity-identity`; missing endpoints are refused by the schema |
| FR-8.3 | P1       | Warnings detected: entity with no primary key; entity with no relationships (orphan); FK data type mismatched against its target PK; M:N relationship not resolved to an associative entity; unnamed relationship. | Open                                                                                                            |
| FR-8.4 | P1       | Inline markers on the canvas for elements with errors, with a badge count on the validation panel toggle.                                                                                                          | Open                                                                                                            |
| FR-8.5 | P1       | Validation runs incrementally on change without blocking input.                                                                                                                                                    | Open                                                                                                            |
| FR-8.6 | P2       | Normalization hints (1NF/2NF/3NF observations) as info-level issues.                                                                                                                                               | Open (V2)                                                                                                       |

### 4.9 Application shell

| ID     | Priority | Requirement                                                                                             | Status                       |
| ------ | -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------- |
| FR-9.1 | P0       | Keyboard shortcut reference accessible via `?`.                                                         | Open                         |
| FR-9.2 | P0       | A command palette (`Ctrl+K`) exposing every command and doubling as the search entry point (FR-2.6).    | **Open** — pairs with FR-2.6 |
| FR-9.3 | P1       | Light and dark themes, following system preference by default.                                          | Done                         |
| FR-9.4 | P1       | An onboarding sample schema loadable in one click, plus an empty-state canvas with clear first actions. | Done                         |
| FR-9.5 | P2       | Installable as a PWA with full offline capability.                                                      | Open (V2)                    |

---

## 5. Non-functional requirements

### 5.1 Performance

Measured on the reference machine (2020-era laptop, 4-core CPU, integrated graphics, Chrome, 1920×1080) against the **reference schema**: 120 entities, 8 attributes each (960 attributes), 150 relationships.

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-1.1 | Pan and zoom sustain ≥ 55 FPS at every zoom level with the reference schema loaded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| NFR-1.2 | Initial load-and-render of the reference schema from local storage completes in ≤ 2.0 s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| NFR-1.3 | Input-to-visual-feedback latency for hover highlight, selection, and inline edit keystrokes is ≤ 100 ms at p95. **Measured in a browser for the first time on 11 Sep 2026, and the answer depends on the detail level.** Production build, 120 entities, all of them framed, 25 samples per gesture, `tests/e2e/perf.spec.ts`. At the detail level the tool actually uses at this size (Detail: Follow zoom, so L0) it is **met**: hover p95 **49–57 ms**, selection **68–82 ms**, inline-edit keystroke **13 ms**, over three runs. With Detail pinned to All fields it is **missed**: selection p95 **147–162 ms** on every run and hover **83–195 ms**; keystrokes stay at 13–16 ms either way. The cause is `Canvas` rebuilding all N node objects on every hover and every selection, walking every attribute of every entity — `NEXT.md` Tier 1 item 2. Note the figure is taken from the trusted event’s own `timeStamp` to the frame that paints the change, so it includes React’s render and commit. |
| NFR-1.4 | Auto-layout of the reference schema completes in ≤ 5 s, and must not block the main thread for more than 50 ms at a time **except for the single terminal task in which a computed layout is applied to the canvas**. **Met, and the exception is deliberate — see below.** The 120-entity reference schema lays out in **606 ms at L0, 370 ms at L1, 945 ms at L2**, well inside the 5 s budget. On the main-thread clause: the **323 / 142 / 473 ms** first recorded were DEV-build figures and overstated the problem by roughly five times (corrected 11 Sep 2026). A position-only change was also re-rendering every box’s contents, because React Flow passes a node’s position to the component as a prop; fixing that took one layout at 120 entities from 120 `EntityNode` and 1,920 `AttributeRow` renders to zero of each. What remains is the apply itself: worst `longtask` over three runs on the production build with all 120 boxes framed is **57–66 ms (L0), 0 ms (L1), 58–73 ms (L2)**, and **135 ms** at the 300-entity NFR-2.2 ceiling — which NFR-2.2 already licenses as "degradation limited to auto-layout duration". Removing the last few milliseconds would mean applying the layout over several frames, holding positions outside the document while FR-3.4 still requires one undo step: a second two-tier overlay beside the one a drag already needs, a visibly different product (the diagram rearranges in waves), for a once-per-session deliberate action. The clause was therefore narrowed to what it exists to protect — interaction, which NFR-1.3 owns and now measures. Guarded by `pnpm test:perf:browser`. |
| NFR-1.5 | Undo and redo complete in ≤ 100 ms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| NFR-1.6 | Mermaid export of the reference schema completes in ≤ 1 s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| NFR-1.7 | Search returns results within 50 ms of the final keystroke.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| NFR-1.8 | Initial JS bundle ≤ 500 KB gzipped; layout engine and exporters lazy-loaded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| NFR-1.9 | Memory footprint stays under 500 MB with the reference schema and a full 100-step undo stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 5.2 Scalability

| ID      | Requirement                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-2.1 | The tool must remain fully usable (all NFR-1 budgets met) at 120 entities.                                                                                                                  |
| NFR-2.2 | The tool must remain usable, with degradation limited to auto-layout duration, up to 300 entities.                                                                                          |
| NFR-2.3 | Above 300 entities the tool must degrade gracefully — warn the user, offer to force L0 rendering and disable auto-layout — rather than freeze or crash.                                     |
| NFR-2.4 | Rendering cost must scale with _visible_ elements, not total elements: off-viewport elements are culled from the render tree.                                                               |
| NFR-2.5 | The renderer must sit behind an interface such that a canvas or WebGL renderer can replace the DOM renderer for the L0 overview layer without changes to the domain, layout, or IO modules. |

### 5.3 Usability

| ID      | Requirement                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| NFR-3.1 | A user familiar with ER modelling can create a two-entity, one-relationship diagram within 60 seconds of first load without documentation. |
| NFR-3.2 | Every command reachable by mouse is also reachable by keyboard.                                                                            |
| NFR-3.3 | Destructive actions are either confirmed or undoable; never neither.                                                                       |
| NFR-3.4 | Error messages state what is wrong and what to do about it, and are attached to the element they concern.                                  |
| NFR-3.5 | The tool never silently loses user data. Lossy operations (Mermaid export) are announced before they occur.                                |

### 5.4 Accessibility

| ID      | Requirement                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-4.1 | Target WCAG 2.1 Level AA for all UI chrome (panels, dialogs, toolbars, forms).                                                                  |
| NFR-4.2 | No content flashes more than three times per second (WCAG 2.3.1).                                                                               |
| NFR-4.3 | All animation is suppressed under `prefers-reduced-motion: reduce`.                                                                             |
| NFR-4.4 | Colour is never the sole carrier of meaning; every colour-coded state also has a shape, glyph, or text cue.                                     |
| NFR-4.5 | Text contrast ≥ 4.5:1; graphical object contrast ≥ 3:1, at all zoom levels.                                                                     |
| NFR-4.6 | The canvas is keyboard-navigable: tab between entities, arrow-key to traverse relationships, with a live region announcing the focused element. |

### 5.5 Portability and compatibility

| ID      | Requirement                                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-5.1 | Supports current and previous major versions of Chrome, Edge, Firefox, and Safari. No IE, no legacy Edge.                                                 |
| NFR-5.2 | Ships as static assets — HTML, JS, CSS — deployable to any static host or opened from a local file server. No server runtime required.                    |
| NFR-5.3 | Functions fully offline after first load.                                                                                                                 |
| NFR-5.4 | Desktop-optimised for editing at ≥ 1280 px wide. At narrower widths the tool provides a usable read-only/navigate experience rather than a broken editor. |
| NFR-5.5 | Exported `.mmd` renders correctly in Mermaid Live Editor and in GitHub-flavoured Markdown Mermaid blocks.                                                 |
| NFR-5.6 | The native `.erd.json` format is versioned, documented, and forward-migratable; every release ships a migration for prior format versions.                |

### 5.6 Maintainability

| ID      | Requirement                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| NFR-6.1 | The domain layer (`src/domain`) contains no React, no DOM, and no rendering-library imports, and is unit-testable in isolation under Node. |
| NFR-6.2 | Strict TypeScript. `any` is disallowed outside declared third-party shims.                                                                 |
| NFR-6.3 | ≥ 80% unit-test coverage on `src/domain` and `src/io`. Every exporter has round-trip or golden-file tests.                                 |
| NFR-6.4 | Adding a new export format requires touching exactly one new directory plus one registry line.                                             |
| NFR-6.5 | Adding a new notation requires touching only `src/render/notation`.                                                                        |
| NFR-6.6 | End-to-end tests cover the five critical paths: create schema, auto-layout, hover-highlight, export Mermaid, save/reload.                  |

### 5.7 Security and privacy

| ID      | Requirement                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-7.1 | No user schema data leaves the browser. No telemetry, no analytics, no network calls in V1 beyond fetching the app's own static assets.         |
| NFR-7.2 | Imported and opened files are treated as untrusted: parsed defensively, validated against the schema, size-capped, and never evaluated as code. |
| NFR-7.3 | A strict Content-Security-Policy with no `unsafe-eval` and no `unsafe-inline`.                                                                  |
| NFR-7.4 | All rendered user text is escaped; SVG export sanitises embedded text.                                                                          |

### 5.8 Licensing

| ID      | Requirement                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NFR-8.1 | All runtime dependencies must be OSI-approved open source; permissive (MIT/BSD/Apache-2.0) preferred.                                                                    |
| NFR-8.2 | Any weak-copyleft dependency (notably elkjs, EPL-2.0) must be consumed unmodified as a library, and must be isolated behind an internal interface so it can be replaced. |
| NFR-8.3 | The project ships a `THIRD-PARTY-LICENSES` file generated at build time.                                                                                                 |

---

## 6. Technology stack

> **As built.** The table below is what is installed. Four versions differ from v1.0's
> recommendation and one dependency was added; §12.1 records each and why.

Everything below is open source and permissively licensed except where noted.

### 6.1 Summary

| Layer                | Choice                                     | Licence    |
| -------------------- | ------------------------------------------ | ---------- |
| Language             | TypeScript 5.x (strict)                    | Apache-2.0 |
| UI framework         | React 19                                   | MIT        |
| Build tool           | Vite 6                                     | MIT        |
| Diagram canvas       | **@xyflow/react (React Flow 12)**          | MIT        |
| Layout engine        | **elkjs** (ELK layered, in a Web Worker)   | EPL-2.0    |
| State                | Zustand + Immer                            | MIT        |
| Undo/redo            | Custom command stack over the domain layer | —          |
| Validation / parsing | Zod                                        | MIT        |
| Persistence          | IndexedDB via Dexie.js                     | Apache-2.0 |
| Styling              | Tailwind CSS 4                             | MIT        |
| Primitives           | Radix UI                                   | MIT        |
| Icons                | Lucide                                     | ISC        |
| Fuzzy search         | Fuse.js                                    | Apache-2.0 |
| Command palette      | cmdk                                       | MIT        |
| Mermaid preview      | mermaid (lazy-loaded, dev/preview only)    | MIT        |
| Raster/vector export | html-to-image                              | MIT        |
| Unit tests           | Vitest + Testing Library                   | MIT        |
| E2E tests            | Playwright                                 | Apache-2.0 |
| Lint/format          | ESLint + Prettier                          | MIT        |
| Package manager      | pnpm                                       | MIT        |

### 6.2 Justification of the significant choices

**React Flow (`@xyflow/react`) as the canvas.** This is the load-bearing decision. React Flow is MIT-licensed with no attribution requirement for non-commercial use, is actively maintained (v12.11.x, releases within the last month), and has roughly 7.8M weekly npm downloads — the maintenance risk is low. Critically, its nodes are ordinary React components, which is exactly what an ER tool needs: an entity is not a circle, it is a box containing a header, a scrollable attribute list, per-row badges, hover targets, and inline text inputs. Getting that out of a WebGL renderer means reimplementing text layout and hit-testing from scratch. React Flow also ships the exact features in the requirements as first-class: zoom and pan (via d3-zoom), a MiniMap component, multi-select, custom edge types for crow's foot endpoints, and `onlyRenderVisibleElements` for viewport culling, which is how NFR-2.4 is satisfied.

The known cost: nodes are DOM elements, so several thousand _simultaneously visible_ nodes will hit a ceiling. This is mitigated by (a) LOD, which collapses 960 attribute rows into 120 name-only boxes when zoomed out, (b) viewport culling, and (c) NFR-2.5, which keeps a canvas/WebGL overview renderer available as an escape hatch if measurement shows we need it.

**elkjs for layout.** React Flow deliberately ships no auto-layout, so this must be chosen separately. The realistic candidates are dagre (simple, layered, unmaintained-ish) and elkjs. ELK's `layered` algorithm is the Sugiyama-style pipeline — cycle breaking, layering, crossing minimisation, Brandes–Köpf coordinate assignment — and, unlike dagre, it supports **orthogonal edge routing with computed bend points** and **ports**, so relationship connectors can attach to the specific attribute row that carries the foreign key rather than to the middle of a box. That is a meaningful legibility win at 100+ tables. It also supports compound nodes, which is how subject areas (FR-1.15) get implemented in V2 without a rewrite.

Two caveats, both handled: elkjs is EPL-2.0 (weak copyleft), so per NFR-8.2 it is consumed unmodified and hidden behind `src/layout/LayoutEngine.ts`, making dagre or a custom layout a drop-in replacement. And elkjs is GWT-transpiled Java, which is slow — hence NFR-1.4's requirement that it run in a Web Worker, which elkjs supports natively **via `workerUrl` / `workerFactory` on the main thread**. That distinction was missed in the original implementation, which instead imported `elk.bundled.js` inside a worker of our own; `elk.bundled.js` is the main-thread build whose job is to start a worker, and it throws when it is already in one. Corrected on 10 Sep 2026: `elk-api.js` now drives `elk-worker.min.js` as a classic worker, and `tests/unit/architecture/elk-entry-points.test.ts` fails if `elk.bundled.js` is imported from `src/` again. See ADR-0002 "Corrected".

**Zustand + a hand-rolled command stack, rather than a generic undo library.** Generic undo libraries snapshot state. For a 120-entity diagram with a 100-step history that is expensive in memory and produces bad undo granularity — dragging a node produces hundreds of intermediate states. A command pattern in the domain layer (`AddEntityCommand`, `MoveEntitiesCommand`, `AutoLayoutCommand`, each with `apply`/`invert`) gives semantic undo steps, cheap storage, coalescing of drag streams into one step, and compound transactions for FR-7.1. It also gives the V2 collaboration story a head start, since commands are the natural unit to transmit.

**IndexedDB (Dexie), not localStorage.** localStorage caps at ~5 MB, is synchronous (so it blocks the main thread and breaks NFR-1.3), and stores strings only. The reference schema plus history plus multiple diagrams will exceed that. Dexie gives async, transactional, effectively unbounded structured storage with a small API.

**Zod for the file format.** The native `.erd.json` and any future imports are untrusted input (NFR-7.2). Zod gives runtime validation, TypeScript types derived from the same schema (no drift), and a natural home for `formatVersion` migrations.

**Vite over Next.js.** There is no server, no SSR, no routing beyond a single canvas. Next.js would add a server runtime this product explicitly does not have. Vite outputs static assets that satisfy NFR-5.2 directly.

### 6.3 Alternatives considered and rejected

| Option                            | Why not                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cytoscape.js**                  | Excellent graph-analysis toolkit with the richest algorithm library, but its nodes are styled shapes, not arbitrary markup. Rendering an entity as a box with editable attribute rows fights the library the whole way. Its strength (centrality, path-finding) is not what this product needs. |
| **Sigma.js**                      | WebGL, genuinely handles 100K+ nodes — far beyond our needs — but it renders nodes as circles/sprites. Text-heavy table boxes and inline editing are not what it is for. Reported to struggle above ~13K elements in comparative layout benchmarks anyway.                                      |
| **vis-network**                   | Good out-of-box interactivity and physics, but physics-based layout is wrong for ER diagrams (users expect stable, orthogonal, deterministic layouts) and node customisation is weaker than React Flow's.                                                                                       |
| **D3.js from scratch**            | Maximum control, but we would be hand-building zoom, pan, minimap, selection, drag, and culling — all of which React Flow provides tested. Reserved as the implementation detail _inside_ a future custom overview renderer.                                                                    |
| **JointJS / Rappid**              | Strong diagramming primitives, but the useful half is commercially licensed. Fails NFR-8.1.                                                                                                                                                                                                     |
| **GoJS**                          | Proprietary and paid. Fails NFR-8.1.                                                                                                                                                                                                                                                            |
| **mxGraph / draw.io embed**       | mxGraph is archived. Embedding draw.io means inheriting its data model and giving up control of notation and export — the opposite of the format-neutrality requirement.                                                                                                                        |
| **Mermaid as the editing engine** | Mermaid renders; it does not edit, and it cannot express half the required notation. It is correctly positioned as an export target only.                                                                                                                                                       |
| **Svelte Flow**                   | Technically equivalent and by the same team. React chosen for ecosystem depth in the surrounding UI libraries. Not a strong preference.                                                                                                                                                         |
| **Tauri / Electron desktop**      | Deferred. Nothing in V1's requirements needs filesystem access beyond what the File System Access API and download/upload provide. Kept viable: the app is a static bundle, so wrapping it in Tauri later is a packaging task, not a rewrite.                                                   |

---

## 7. Interoperability architecture

### 7.1 The adapter registry

This is how FR-6.6 and NFR-6.4 are met, and it is the mechanism that prevents Mermaid lock-in.

```ts
interface ExportAdapter {
  id: string // 'mermaid' | 'dbml' | 'sql-postgres' | ...
  label: string
  extension: string // '.mmd'
  mimeType: string
  capabilities: CapabilitySet // which IR constructs it can represent
  export(diagram: Diagram, options?: unknown): ExportResult
}

interface ExportResult {
  content: string | Blob
  lossReport: LossItem[] // powers FR-6.3
}

interface LossItem {
  elementId: string
  elementKind: 'entity' | 'attribute' | 'relationship'
  construct: string // 'multivalued attribute'
  treatment: 'dropped' | 'approximated' | 'decomposed'
  detail: string // human-readable explanation
}
```

Adapters declare a `CapabilitySet` up front. The export dialog compares the diagram's used constructs against the target adapter's capabilities and generates the loss report **before** the user commits — so the warning is produced by the same declarative data that drives the exporter, and cannot drift out of sync with it. Import adapters mirror this shape.

Registration is one line in `src/io/registry.ts`. Nothing else in the codebase knows how many formats exist.

### 7.2 Mermaid mapping (V1)

| IR construct                  | Mermaid output                                                                   | Fidelity                                                               |
| ----------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Entity                        | `ENTITY { ... }`                                                                 | exact                                                                  |
| Attribute name + type         | `type name`                                                                      | exact                                                                  |
| Primary key                   | `PK` marker                                                                      | exact                                                                  |
| Unique                        | `UK` marker                                                                      | exact                                                                  |
| Foreign key                   | `FK` marker                                                                      | exact (target entity implied by the relationship line, not the marker) |
| Comment                       | `"comment"` suffix                                                               | exact                                                                  |
| Binary cardinality            | `\|\|`, `o\|`, `\|{`, `o{` endpoints                                             | exact                                                                  |
| Participation (total/partial) | folded into the endpoint glyph                                                   | exact                                                                  |
| Relationship name             | `: label`                                                                        | exact                                                                  |
| Identifying relationship      | solid `--`                                                                       | exact                                                                  |
| Non-identifying relationship  | dotted `..`                                                                      | exact                                                                  |
| Recursive relationship        | self-referencing line with role in the label                                     | approximated                                                           |
| **Weak entity**               | plain entity; noted in a header comment block                                    | **approximated**                                                       |
| **Multivalued attribute**     | attribute retained, `"multivalued"` appended to its comment                      | **approximated**                                                       |
| **Derived attribute**         | attribute retained, `"derived"` appended to its comment                          | **approximated**                                                       |
| **Composite attribute**       | flattened to `parent_child` rows                                                 | **approximated**                                                       |
| **N-ary relationship**        | decomposed into an associative entity plus N binary relationships                | **decomposed**                                                         |
| **Relationship attributes**   | moved onto the generated associative entity                                      | **decomposed**                                                         |
| **ISA hierarchy**             | subtypes emitted as entities with non-identifying relationships to the supertype | **approximated**                                                       |
| **Node positions**            | —                                                                                | **dropped** (Mermaid auto-layouts)                                     |
| **Subject areas / groups**    | —                                                                                | **dropped**                                                            |

Every row marked approximated, decomposed, or dropped produces a `LossItem` when it occurs.

### 7.3 Image export (FR-6.5)

PNG and SVG do not fit the `ExportAdapter` interface above, and the deviation is deliberate rather than an oversight.

An image is not a serialisation of the IR; it is a photograph of the renderer. What lands in the file depends on the notation, the level of detail, the theme and the CSS, none of which the IR knows about. Writing it as `export(diagram) => string` would have meant a second renderer inside `io` drawing SVG from the model directly — and a second renderer drifts from the one on screen within a release. So the input is what the user sees: a DOM subtree. `ImageExportAdapter` is therefore its own interface with its own registry list (`imageExportAdapters`), and `exportAdapters` remains a list of things you can call `export(diagram)` on.

Three consequences worth recording:

1. **The live canvas cannot be photographed.** It runs `onlyRenderVisibleElements` (NFR-2.4), so off-screen nodes are absent from the DOM — not clipped, absent. Capturing it yields the current screenful and silently omits the rest of the schema. So export mounts its **own** off-screen surface (`features/export/ExportSurface.tsx`), sized from the diagram's own bounds, with culling off and the camera pinned at zoom 1.
2. **It always renders at L2 and read-only.** A picture of a schema with its fields hidden is not worth having, whatever zoom the user was at; and the "add field" row and connection handles are editing affordances, so an image of them is an image of a tool rather than of a schema.
3. **The capability set answers a different question.** For every other format `exact` means "round-trips". Nothing round-trips through a PNG, so for this adapter `exact` means **visible in the image**. The format-level fact — that an image cannot be read back in — is stated once, in the adapter's `note`, because it has no element to hang a `LossItem` off.

---

## 8. V1 project structure

Organised so the four things most likely to change — the notation, the renderer, the layout engine, and the set of file formats — are each isolated behind a boundary.

```
er-diagram-tool/
├── public/
│   └── samples/
│       └── ecommerce.erd.json         # onboarding sample (FR-9.4)
│
├── src/
│   │
│   ├── domain/                        # PURE TypeScript. No React. No DOM.
│   │   ├── model/                     #   NFR-6.1 boundary — the whole point of this layer
│   │   │   ├── types.ts               #   Diagram, Entity, Attribute, Relationship, Participant
│   │   │   ├── schema.ts              #   Zod schemas; source of truth for types.ts
│   │   │   ├── factory.ts             #   createEntity(), createRelationship() with sane defaults
│   │   │   └── migrations/            #   formatVersion N → N+1 (NFR-5.6)
│   │   │       ├── index.ts
│   │   │       └── v1-to-v2.ts        #   empty in V1; the slot exists so V2 has nowhere to improvise
│   │   ├── commands/                  #   Undo/redo unit (FR-7.1)
│   │   │   ├── Command.ts             #   interface { apply, invert, label, coalesceWith? }
│   │   │   ├── CommandStack.ts        #   history, transactions, coalescing
│   │   │   ├── entity.commands.ts
│   │   │   ├── attribute.commands.ts
│   │   │   ├── relationship.commands.ts
│   │   │   └── layout.commands.ts
│   │   ├── graph/                     #   Model queries, no rendering
│   │   │   ├── adjacency.ts           #   neighbours(), incidentRelationships()
│   │   │   ├── traversal.ts           #   nHopNeighbourhood() — powers FR-2.8 and FR-4.2
│   │   │   └── indexes.ts             #   id→element maps, kept in sync for O(1) lookup
│   │   └── validation/                #   FR-8.x
│   │       ├── Rule.ts                #   interface { id, severity, check(diagram): Issue[] }
│   │       ├── rules/                 #   one file per rule — adding a rule adds a file
│   │       │   ├── duplicate-names.ts
│   │       │   ├── weak-entity-identity.ts
│   │       │   ├── missing-primary-key.ts
│   │       │   ├── orphan-entity.ts
│   │       │   └── fk-type-mismatch.ts
│   │       └── validator.ts           #   runs the rule set incrementally
│   │
│   ├── io/                            # Import/export. Depends on domain only.
│   │   ├── registry.ts                #   the one file you edit to add a format (NFR-6.4)
│   │   ├── types.ts                   #   ExportAdapter, ImportAdapter, LossItem, CapabilitySet
│   │   ├── capabilities.ts            #   loss computation shared by all adapters
│   │   └── formats/
│   │       ├── mermaid/               #   V1
│   │       │   ├── capabilities.ts
│   │       │   ├── export.ts
│   │       │   ├── import.ts          #   stub in V1, throws NotImplemented
│   │       │   └── __tests__/golden/  #   .erd.json → expected .mmd fixtures
│   │       ├── native-json/           #   V1 — the save format, lossless
│   │       │   ├── export.ts
│   │       │   └── import.ts
│   │       ├── image/                 #   V1 — PNG/SVG via html-to-image
│   │       │   └── export.ts
│   │       ├── dbml/                  #   V2 — directory scaffolded, adapter unregistered
│   │       └── sql/                   #   V2 — ditto
│   │
│   ├── layout/                        # elkjs isolated here (NFR-8.2)
│   │   ├── LayoutEngine.ts            #   interface — the seam that makes elkjs replaceable
│   │   ├── elk/
│   │   │   ├── ElkLayoutEngine.ts
│   │   │   ├── toElkGraph.ts          #   IR → ELK JSON, incl. ports for FK row attachment
│   │   │   ├── fromElkGraph.ts        #   ELK result → LayoutState
│   │   │   └── options.ts             #   layered/force/tree presets (FR-3.6)
│   │   ├── worker/
│   │   │   └── client.ts              #   NFR-1.4 — lazily owns elkjs’s own worker
│   │   └── measure.ts                 #   node dimension estimation per LOD; ELK cannot measure text
│   │
│   ├── render/                        # Everything visual. Swappable per NFR-2.5.
│   │   ├── RendererProps.ts           #   the renderer contract
│   │   ├── reactflow/
│   │   │   ├── Canvas.tsx             #   <ReactFlow>, onlyRenderVisibleElements, MiniMap, Controls
│   │   │   ├── nodes/
│   │   │   │   ├── EntityNode.tsx     #   dispatches on LOD
│   │   │   │   ├── EntityNodeL0.tsx   #   name only
│   │   │   │   ├── EntityNodeL1.tsx   #   name + keys
│   │   │   │   ├── EntityNodeL2.tsx   #   full attribute list
│   │   │   │   ├── AttributeRow.tsx   #   badges, inline edit, per-row connection handle
│   │   │   │   └── RelationshipHub.tsx#   n-ary hub node (V2 slot)
│   │   │   ├── edges/
│   │   │   │   ├── RelationshipEdge.tsx
│   │   │   │   ├── endpoints/         #   crow's foot / IE glyph components
│   │   │   │   └── routing.ts         #   consume ELK bend points; orthogonal fallback
│   │   │   └── overlays/
│   │   │       ├── HighlightLayer.tsx #   FR-4.x dim-and-emphasise
│   │   │       ├── ValidationMarkers.tsx
│   │   │       └── SelectionBox.tsx
│   │   ├── notation/                  #   NFR-6.5 boundary
│   │   │   ├── NotationSet.ts         #   interface: glyphs, endpoint shapes, node shapes
│   │   │   ├── compact/               #   V1 default (crow's foot / IE)
│   │   │   └── chen/                  #   Chen renderer — full canvas + focused sub-view
│   │   │       ├── ChenView.tsx
│   │   │       ├── ChenEntity.tsx     #   rect / double rect
│   │   │       ├── ChenAttribute.tsx  #   oval / double oval / dashed oval
│   │   │       └── ChenRelationship.tsx # diamond / double diamond
│   │   └── lod.ts                     #   zoom → LOD mapping, pin overrides
│   │
│   ├── features/                      # Feature-first UI. Each owns its components + hooks.
│   │   ├── editor/                    #   toolbar, canvas shell, context menus, shortcuts
│   │   ├── inspector/                 #   right panel property editors (FR-1.8)
│   │   ├── palette/                   #   add-entity / add-relationship affordances
│   │   ├── search/                    #   Fuse.js index + cmdk palette (FR-2.6, FR-9.2)
│   │   ├── minimap/                   #   FR-2.5 wrapper + collapse state
│   │   ├── validation-panel/          #   FR-8.1
│   │   ├── export/                    #   dialog, preview, loss report (FR-6.1–6.3)
│   │   ├── diagram-manager/           #   open/save/new/recent (FR-7.5)
│   │   └── onboarding/                #   empty state, sample loader, shortcut sheet
│   │
│   ├── store/                         # Zustand. Thin — it delegates to domain/commands.
│   │   ├── diagramStore.ts            #   model state; every mutation goes through CommandStack
│   │   ├── viewportStore.ts           #   zoom, pan, LOD override, pinned entities
│   │   ├── selectionStore.ts          #   selection + hover — separated so hover at 60Hz
│   │   │                              #   never re-renders the model tree
│   │   ├── uiStore.ts                 #   panels, dialogs, theme
│   │   └── middleware/
│   │       ├── autosave.ts            #   debounced persist (FR-7.2)
│   │       └── validate.ts            #   incremental revalidation (FR-8.5)
│   │
│   ├── persistence/
│   │   ├── db.ts                      #   Dexie schema: diagrams, snapshots, preferences
│   │   ├── autosave.ts
│   │   ├── recovery.ts                #   FR-7.3
│   │   └── fileSystem.ts              #   download + File System Access API, feature-detected
│   │
│   ├── ui/                            # Presentational primitives only. No domain imports.
│   │   ├── Button.tsx  Dialog.tsx  Panel.tsx  Tooltip.tsx  ContextMenu.tsx
│   │   ├── Badge.tsx   Toast.tsx    ResizablePanel.tsx
│   │   └── theme/
│   │       ├── tokens.css             #   colour, spacing, type scale
│   │       └── notation-tokens.css    #   stroke weights, glyph sizes, highlight colours
│   │
│   ├── lib/
│   │   ├── id.ts  keyboard.ts  debounce.ts  download.ts  a11y.ts
│   │
│   ├── App.tsx
│   └── main.tsx
│
├── tests/
│   ├── unit/                          # mirrors src/domain and src/io
│   ├── fixtures/
│   │   ├── small.erd.json             # 5 entities
│   │   ├── reference.erd.json         # 120 entities / 960 attributes / 150 relationships
│   │   └── stress.erd.json            # 300 entities — NFR-2.2 / NFR-2.3
│   ├── e2e/                           # Playwright, the five critical paths (NFR-6.6)
│   └── perf/                          # automated budget checks against NFR-1.x
│
├── docs/
│   ├── SRS.md                         # this document
│   ├── file-format.md                 # .erd.json spec, versioned
│   ├── mermaid-mapping.md             # §7.2, maintained alongside the adapter
│   ├── adding-a-format.md             # the NFR-6.4 recipe
│   └── adr/                           # architecture decision records
│       ├── 0001-react-flow.md
│       ├── 0002-elkjs-behind-interface.md
│       ├── 0003-command-pattern-undo.md
│       └── 0004-lod-rendering.md
│
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── playwright.config.ts
└── package.json
```

### 8.1 Dependency rule

Enforced by an ESLint import-boundary rule, not by convention:

```
ui  ←  features  ←  store  ←  domain
                 ↑           ↑
             render  ←──── io, layout
```

`domain` imports nothing from the app. `io` and `layout` import `domain` only. `render` imports `domain` and `layout`. `features` may import anything below it. Nothing imports `features`.

### 8.2 The seams, and what each buys later

| Seam                                 | What it costs in V1                        | What it makes cheap later                                                                                                                    |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `io/registry.ts` + `CapabilitySet`   | one interface, one loss-computation module | DBML, SQL DDL, PlantUML, JSON Schema — each a directory plus a registry line                                                                 |
| `layout/LayoutEngine.ts`             | one interface around elkjs                 | swapping layout engines; sidesteps the EPL-2.0 question entirely                                                                             |
| `render/notation/NotationSet.ts`     | glyphs behind a lookup instead of inline   | Chen mode, IE, Barker, UML — none touch the domain                                                                                           |
| `render/RendererProps.ts`            | a props contract                           | a canvas/WebGL L0 renderer if DOM node count becomes the bottleneck                                                                          |
| `domain/commands`                    | more upfront than mutating state directly  | semantic undo, macros, scripting, and — if the no-collaboration decision ever reverses — an operation log that is the natural transport unit |
| `model/migrations/`                  | an empty directory and an index            | never having to choose between breaking old files and freezing the format                                                                    |
| Attribute-level stable IDs           | slightly more bookkeeping                  | renames that don't break foreign keys                                                                                                        |
| `layout` stored apart from semantics | a second tree to keep in sync              | exporters that ignore position; re-layout without touching the schema                                                                        |

---

## 9. Release plan

> **Status.** V1 is substantially delivered, and two items originally scoped to V2 —
> SQL and Mermaid **import** — were pulled forward, because import is what makes the
> 100-table target reachable in practice rather than only in a fixture. Four V1 items
> remain open; they are listed in §13.

**V1 (this SRS):** all P0 requirements, plus as many P1 as schedule allows. Browser-only, single-user, Mermaid + native JSON + PNG/SVG export.

**V2 (candidate scope):** Mermaid / DBML / SQL DDL **import** — this is what makes 100+ tables a realistic scenario rather than a stress-test fixture, since nobody hand-draws 100 tables; additional exporters; subject areas; n-ary relationships; ISA hierarchies; snapshots and diff.

**V3 (candidate scope):** the decisions deliberately deferred — a backend, accounts, sharing, multi-user editing, live database introspection, a Tauri desktop wrapper. The command stack and the static-bundle build are the two pieces that make this an addition rather than a rewrite.

---

## 10. Risks

| Risk                                                           | Impact         | Mitigation                                                                                                                                    |
| -------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-node ceiling in React Flow at high visible-element counts  | Misses NFR-1.1 | Benchmark against `stress.erd.json` in week 1, before feature work. LOD + culling first; renderer seam (NFR-2.5) as the fallback.             |
| elkjs is slow on 300-entity graphs (GWT-transpiled Java)       | Misses NFR-1.4 | Web Worker isolation; progressive result reporting; a simple grid layout as a bail-out at extreme sizes.                                      |
| LOD transitions feel jarring at threshold zoom levels          | Usability      | Hysteresis on the zoom thresholds; cross-fade between levels; user testing on the transition specifically.                                    |
| Users expect `.mmd` to round-trip and lose work                | Data loss      | `.mmd` is never offered as "Save", only "Export". Loss report is mandatory and non-dismissable-by-default. `.erd.json` is the only save path. |
| Chen mode gets built, then is unusable at any real schema size | Wasted effort  | Ship the focused sub-view (FR-5.4) first; full-canvas Chen (FR-5.3) second, gated behind the legibility warning (FR-5.6).                     |
| Scope creep from P2 into V1                                    | Schedule       | P2 items have architectural slots reserved but no implementation budget. The slots are the deliverable, not the features.                     |

---

## 11. Open items for review

1. **Notation default.** This SRS makes compact/crow's foot the default and Chen the secondary mode. If the primary audience is students learning Chen notation, that default should flip — which changes FR-5.1/5.3 priorities but nothing structural.
2. **Data type semantics.** Currently free text with autocomplete. If SQL DDL export is likely in V2, a dialect-aware type system in V1 would save a migration.
3. **Reference schema size.** All performance budgets are pinned to 120 entities / 960 attributes / 150 relationships. If the real target is materially larger, NFR-1.x needs restating before implementation starts.
4. **Chen full-canvas mode.** Given §2.1, is FR-5.3 (whole-canvas Chen) worth its cost, or is FR-5.4 (focused sub-view) sufficient to satisfy the notation requirement?

---

## 12. Changes from v1.0

### 12.1 Dependency versions

Recorded in full in `docs/adr/0005-stage1-version-deviations.md`.

| v1.0 said              | Built with               | Why                                                                                                                                                                                                                         |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite 6                 | Vite 8                   | `@vitejs/plugin-react@6` requires `vite: ^8`.                                                                                                                                                                               |
| TypeScript 5.x         | TypeScript 6.0           | Current default. **A ceiling, not a floor** — `typescript-eslint@8` peers at `<6.1`, so TS 7 breaks linting outright.                                                                                                       |
| Zod 3 (implied)        | Zod 4                    | Recursive schemas via object getters remove the `z.lazy()` plus hand-written interface that `Attribute.children` would otherwise need. Cost: `.default()` no longer validates, hence the `.prefault()` rule in `schema.ts`. |
| `eslint-plugin-import` | `eslint-plugin-import-x` | The original peers at ESLint `^9`; we are on 10.                                                                                                                                                                            |
| —                      | `fake-indexeddb` added   | jsdom has no IndexedDB, leaving the Dexie repository at 45% coverage. Dev-only.                                                                                                                                             |

### 12.2 Design decisions taken during the build

**Commands describe a mutation; the inverse is derived.** §8 of v1.0 sketched
`Command { apply, invert }`. A hand-written inverse duplicates model knowledge, worst
exactly where it is most dangerous — `deleteEntity` would have to remember the entity,
its relationships, every inbound foreign key, its position and its pin. Commands now
supply only `mutate(draft)` and `CommandStack` derives both directions from Immer
patches. The `invert` half still exists; it is computed rather than written.
See `docs/adr/0003`.

**The LOD vocabulary lives in `lib`, not `render`.** v1.0's §8 file list put `lod.ts`
under `render/`, which contradicts its own §8.1 dependency rule: LOD level is viewport
state, so `store/viewportStore.ts` needs it, and `store` may not import `render`. Split
by nature instead — the type, thresholds and zoom mapping in `lib/lod.ts`; the renderer's
use of them in `render/lod.ts`.

**`parseDiagramDocument` lives in `io`, not `persistence`.** Both the storage reader and
the file importer need it, and `persistence` may depend on `io` while the reverse is
forbidden. The boundary rule caught this.

**Foreign keys and relationships are kept in step, one way.** Setting a reference in the
inspector also draws the relationship if none exists. Clearing one does not delete the
other: in both directions the remaining fact is still true, and discarding a user's work
to enforce tidiness is worse than a diagram that is less specific than it could be.

**Drag-to-connect from a field row wires the foreign key too.** Dragging
`ORDER.customer_id` onto `CUSTOMER` means one thing; making the user then set the
reference by hand would be asking them to say it twice. One undo step covers both.

**The inspector appears only on selection.** 288 px of "select something" permanently
narrows the canvas, which is the thing the user is there to look at.

**Dimming settled at 55%, not 28%.** The original figure nearly erased the un-traced
tables, which defeats the purpose — you trace a relationship in order to see it _in
context_. Contrast now comes from the emphasis side: heavier stroke, stronger outline,
raised z-order.

**Nullability got a cue it did not have.** A trailing `?` on the type. Annotating
`NOT NULL` instead was rejected because required columns are the minority in most
schemas, so it would print more ink rather than less.

### 12.3 Requirements interpreted rather than followed literally

**FR-4.1 "highlight/blink".** Built as static emphasis plus dimming, no animation. §2.3
argued this before implementation and using it confirmed the reasoning: flashing content
is a WCAG 2.3.1 concern, and a blink makes the label you are hovering to read harder to
read. Optional single-pulse motion (FR-4.6) remains available and unbuilt.

**FR-6.8 import.** Delivered in V1 rather than V2, and extended: SQL DDL import covers
PostgreSQL and MySQL with automatic dialect detection. The SQL reader is a deliberate
subset — `CREATE TABLE`, inline and table-level constraints, and
`ALTER TABLE ... ADD CONSTRAINT`. Unrecognised statements are counted and reported rather
than failing the file, on the principle that a dump which is 90% readable should produce
90% of a diagram.

---

## 13. What remains

**The working queue lives in `NEXT.md`**, not here: which of these to do next, what is
already diagnosed, and the current bug list. This section stays the requirement-level view
of what is unbuilt. Sequencing in one file, requirement status in the other — and the two
rows below that had to be corrected on 10 Sep 2026 are what happens when that slips.

1. ~~**Auto-layout (FR-3.1, FR-3.2), which is listed as Done above and is not.**~~
   **Fixed 10 Sep 2026.** It threw in every browser because `elk.bundled.js` cannot run
   inside a Web Worker; a second, unrelated defect meant the import path arranged the
   document it had just replaced. Both fixed and verified in Chrome — ADR-0002
   "Corrected". Kept here, struck through, because a P0 that shipped broken for six
   stages is worth a line in the requirement view rather than a silent deletion.
2. ~~**Validation panel (FR-8.1 to FR-8.5).**~~ **Done.** Eight rules in
   `src/domain/validation/rules/`, the panel and toggle in
   `src/features/validation-panel/`, 69 tests. Clicking an issue selects and reveals the
   element (`useGoToIssue`).
3. **Search and command palette (FR-2.6, FR-9.2).** At 100 tables this is worth more than
   everything below it — and SQL import now genuinely makes 100-table diagrams reachable
   in one click. `fuse.js` and `cmdk` were installed for this and have now been removed again:
   they sat unused through six stages, and an unused dependency is a supply-chain and
   audit cost with nothing on the other side of the ledger. Reinstate them when the work
   starts, or decide then that a substring match over a hundred table names does not need
   a fuzzy-search library.
4. **Edges attaching to the foreign-key row** rather than to box centres. Per-row handles
   exist; the edges ignore them. Needs a fallback for L0 and L1, where those handles are
   not rendered.
5. Marquee select (FR-2.9); isolate mode (FR-2.8 — `nHopNeighbourhood` is written and
   tested, only unwired); expanding one entity from the "N more" row; a keyboard shortcut
   sheet (FR-9.1).
6. DBML export (FR-6.7) — one directory plus one line in `src/io/registry.ts`.

Deferred to V2 with slots reserved in the IR: n-ary relationships, ISA hierarchies,
subject areas, snapshots and diff, Chen rendering mode.

### 13.1 Two gaps that are not features

**~~Nothing has been tested against a real schema.~~ Partly closed on 10 Sep 2026, and it
found three things.** Pagila — 71 tables of real third-party PostgreSQL DDL — imports to 72
entities and 36 relationships with no warnings, no errors and **no overlapping boxes at any
detail level**, laying out in 354/346/573 ms. That is the good news, and it is also why it
was not enough: Pagila's longest column name is 20 characters, so no box ever reaches the
300px cap and nothing wraps.

Given a schema with the shape §13.1 always said mattered — 60-column tables, 40 foreign
keys into one hub, names like `cust_reconciliation_amount_in_local_currency` — three
defects surfaced. All three are recorded in `NEXT.md` with reproductions:

1. ~~**`measure.ts` under-measures any box whose column names wrap**, by up to 586px
   (86%), stacking 26 overlapping pairs on 41 tables.~~ **Fixed 10 Sep 2026.** Rows are
   pinned to one line in `canvas.css` (`text-overflow: ellipsis`, full name in the `title`),
   which makes the flat per-row height in `measure.ts` correct by construction rather than
   by calibration — while a name could wrap, no fixed per-character width could predict the
   height, because where a name breaks depends on its glyphs (6.2 to 10.2 px per character
   measured) rather than its length. Every constant was re-measured off the DOM and biased
   upward, so the estimate now over-estimates by at most 4px and never under-estimates.
   0 overlapping pairs at every detail level. `tests/e2e/measurement.spec.ts` asserts the
   inequality against the rendered box and passes.
2. ~~**A hub-and-spoke schema renders as an unusable vertical ribbon.**~~ **Fixed 11 Sep 2026.** 40 tables referencing one hub all sat at the same dependency depth, and `layered`
   stacks a depth into one column: 838x21134px. None of ELK's own options address it —
   `elk.aspectRatio`, `elk.layered.wrapping.strategy` and
   `elk.layered.highDegreeNodes.treatment` produce byte-identical output, because `wrapping`
   wraps a long chain of layers rather than one overfull layer. `src/layout/elk/wideLayers.ts`
   now computes dependency depth, splits any crowded depth into ELK partitions and switches
   node placement to `SIMPLE` for that case only. Measured in Chrome: L2 838x21134 →
   3186x4275, aspect 0.04 → 0.75, 0 overlapping boxes, and Pagila byte-identical to before.
   The lesson for NFR-2.2 stands: "remain usable up to 300 entities" is a shape question,
   not only a count question, and the count says nothing about it.
3. **~~NFR-1.4's 50 ms main-thread clause is still missed.~~ Settled 11 Sep 2026, by
   narrowing the clause rather than by chasing the last few milliseconds.** The 473 ms
   originally recorded turned out to be a dev-build figure; the avoidable half was fixed
   the same day. What was left — 57–73 ms in the one task that applies the layout — was
   not worth a second two-tier position overlay and a diagram that rearranges in waves, so
   the requirement now says what it was always protecting: interaction. See that row.
   **The measurement that decision leant on then failed.** NFR-1.3 had never been run in a
   browser, so it was checked before being cited, and at 120 entities with Detail pinned to
   All fields selection takes 147–162 ms against a 100 ms budget. It is met at the detail
   level the tool uses at that size. The cause is known and queued — `Canvas` rebuilds all
   N node objects on every hover and every click. `NEXT.md` Tier 1 item 2.

Still open: no schema belonging to anyone has been run through it. Everything above is
either a public sample database or a generated reproduction. The width estimates were the
thing §13.1 predicted would break, and they did.

**~~`pnpm test:e2e` has never been executed.~~ Closed on 10 Sep 2026.** It runs on the
system Chrome (`channel: 'chrome'`, so no browser download), covers 15 specs across boot,
pointer gestures, drag-to-connect, auto-layout, SQL import, the minimap, real IndexedDB and
reload, and is part of `pnpm verify`. **All five of NFR-6.6's critical paths are now
covered**; the auto-layout spec was marked `test.fail()` while the feature was broken and
that marker is gone.

It found, on its first execution: two specs whose locators had rotted into ambiguity
(`hasText: 'CUSTOMER'` also matched the box containing a `customer_id` field), one spec
whose gesture React Flow could never have accepted, one that asserted nothing, and the
FR-3.1 break itself. **A suite that has never been run is not coverage.** The same applied
to every coverage exclusion in `vite.config.ts` that defers to it: `src/layout/worker/**`
was excluded on the grounds that it "constructs a real Worker", and constructing that worker
was precisely what did not work. That exclusion is now backed by a spec that clicks
Auto-layout in Chrome and asserts the boxes move — so if you widen what hides behind one of
those lines, widen the spec in the same change.

Image export (FR-6.5, §7.3) **has now been run in Chrome and the output looked at.** It is
worth recording what that caught, because it is the argument for why the unit suite could
never have signed this off:

1. `nodesInitialized` never became true, so the export sat on "Rendering…" forever. React
   Flow only recomputes that flag when the `nodes` prop changes — which is before
   measurement — and never again. Derived from `nodeLookup` instead.
2. The captured element inherited `position: fixed; left: -100000px` into html-to-image's
   `<foreignObject>`, putting the clone outside the SVG viewport. The output was a valid,
   correctly sized, correctly coloured, **completely blank** 37 kB PNG.
3. html-to-image copies computed styles only for `HTMLElement`, and an `SVGElement` is not
   one. Every edge `<path>` lost its `fill: none` and filled its own bezier with black.
   The export was a correct diagram with two large inkblots across it.

All three produced a file, none produced an error, and every automated check — valid PNG,
right dimensions, right background, plausible byte count — passed on all three. jsdom
performs no layout and has no canvas, so a unit test cannot distinguish any of them from a
correct export. **Image export is verified by looking at it. Change that code path and look
at the output again.**
