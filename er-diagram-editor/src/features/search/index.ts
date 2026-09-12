// The Ctrl+K search and command palette (FR-2.6, FR-9.2).

export { CommandPalette, type CommandPaletteProps, type PaletteCommand } from './CommandPalette'
export {
  buildSearchRecords,
  searchRecords,
  type AttributeRecord,
  type EntityRecord,
  type RelationshipRecord,
  type SearchHit,
  type SearchRecord,
} from './searchIndex'
