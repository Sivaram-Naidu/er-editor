# ADR 0001 - React Flow as the canvas

**Status:** accepted (SRS S6.2)

**Decision:** `@xyflow/react` v12 (MIT) over Cytoscape.js, Sigma.js, vis-network, raw D3.

**Rationale:** nodes are ordinary React components, which is what an entity box with
editable attribute rows, per-row badges and per-row connection handles requires.
Ships zoom/pan, MiniMap, multi-select and `onlyRenderVisibleElements` (NFR-2.4).

**Cost:** nodes are DOM elements, so simultaneously-visible node count has a ceiling.
Mitigated by LOD (SRS S2.2), viewport culling, and the renderer seam in NFR-2.5.
