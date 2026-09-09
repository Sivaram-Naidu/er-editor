// Public surface of the commands module.

export { defineCommand, type Command } from './Command'
export {
  CommandStack,
  type CommandStackOptions,
  type CommandStackSnapshot,
  type HistoryEntry,
} from './CommandStack'

export {
  addAttribute,
  deleteAttribute,
  moveAttribute,
  renameAttribute,
  setForeignKey,
  updateAttribute,
  type AttributePatch,
} from './attribute.commands'

export {
  addEntity,
  deleteEntity,
  renameDiagram,
  renameEntity,
  setEntityKind,
  updateEntity,
  type EntityPatch,
} from './entity.commands'

export { applyLayout, moveEntities, setPinned } from './layout.commands'

export {
  addRelationship,
  deleteRelationship,
  renameRelationship,
  setIdentifying,
  updateParticipant,
  type ParticipantPatch,
} from './relationship.commands'
