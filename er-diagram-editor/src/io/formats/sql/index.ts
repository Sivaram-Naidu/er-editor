// SQL DDL import (FR-6.8).

import type { ImportAdapter } from '../../types'

import { importSql } from './import'

export const sqlImporter: ImportAdapter = {
  id: 'sql',
  label: 'SQL schema (.sql)',
  extension: '.sql',
  import: (content) => importSql(content),
}

export { importSql, type SqlImportOptions } from './import'
export { detectDialect, type SqlDialect } from './tokenize'
