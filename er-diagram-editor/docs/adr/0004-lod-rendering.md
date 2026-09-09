# ADR 0004 - Zoom-driven level of detail

**Status:** accepted (SRS S2.2, FR-2.4)

**Decision:** three render levels - L0 name-only below 40% zoom, L1 name plus keys at
40-90%, L2 full attributes above 90% - with per-entity pin override (FR-2.7).

**Rationale:** the single most important scalability mechanism. Keeps drawn glyph count
proportional to what fits on screen rather than to schema size. Without it, 120 entities
x 8 attributes is ~960 attribute rows in the DOM at all times.

**Risk:** transitions at threshold zoom can feel jarring. Mitigated with hysteresis on
the thresholds and a cross-fade.
