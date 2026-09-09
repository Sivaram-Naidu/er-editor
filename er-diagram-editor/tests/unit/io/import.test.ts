/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import type { Diagram, Entity } from '../../../src/domain'
import { detectDialect, exportMermaid, importMermaid, importSql } from '../../../src/io'
import { splitStatements, splitTopLevel, stripComments } from '../../../src/io/formats/sql/tokenize'
import { importFile, needsLayout } from '../../../src/features/import'

const entity = (diagram: Diagram, name: string): Entity | undefined =>
  diagram.entities.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())

// ─────────────────────────────────────────────────────────────────────────────
// Tokenising — where hand-rolled SQL readers actually break
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenising', () => {
  it('does not treat -- inside a string literal as a comment', () => {
    // Getting this wrong truncates the statement and loses every column after it.
    const sql = "CREATE TABLE t (note text DEFAULT 'a -- b');"

    expect(stripComments(sql)).toContain("'a -- b'")
  })

  it('strips line and block comments', () => {
    const sql = 'CREATE TABLE t ( -- hello\n  id int /* inline */\n);'
    const stripped = stripComments(sql)

    expect(stripped).not.toContain('hello')
    expect(stripped).not.toContain('inline')
    expect(stripped).toContain('id int')
  })

  it('does not split on a semicolon inside a string', () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;")).toHaveLength(2)
  })

  it('does not split a column list on a comma inside a type', () => {
    // The single most common way a naive reader loses a column.
    expect(splitTopLevel('id int, price numeric(10,2), name text')).toEqual([
      'id int',
      'price numeric(10,2)',
      'name text',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dialect detection
// ─────────────────────────────────────────────────────────────────────────────

describe('dialect detection', () => {
  it('recognises MySQL by backticks and ENGINE', () => {
    expect(detectDialect('CREATE TABLE `t` (`id` int) ENGINE=InnoDB;')).toBe('mysql')
  })

  it('recognises PostgreSQL by SERIAL', () => {
    expect(detectDialect('CREATE TABLE t (id SERIAL PRIMARY KEY);')).toBe('postgres')
  })

  it('defaults to PostgreSQL when a script shows neither', () => {
    // ANSI-ish quoting is the safer guess for a script of unknown origin.
    expect(detectDialect('CREATE TABLE t (id int);')).toBe('postgres')
  })

  it('is not fooled by a backtick inside a string literal', () => {
    expect(detectDialect("CREATE TABLE t (note text DEFAULT 'a ` b'); -- SERIAL")).toBe('postgres')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL
// ─────────────────────────────────────────────────────────────────────────────

const POSTGRES = `
-- A small shop schema
CREATE TABLE "customer" (
    id          uuid PRIMARY KEY,
    email       character varying(255) NOT NULL UNIQUE,
    created_at  timestamp with time zone DEFAULT now(),
    full_name   text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED
);

CREATE TABLE orders (
    id          uuid NOT NULL,
    customer_id uuid NOT NULL,
    total       numeric(10,2),
    CONSTRAINT orders_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY orders
    ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customer(id);

CREATE INDEX orders_customer_idx ON orders (customer_id);
`

describe('PostgreSQL import', () => {
  const result = importSql(POSTGRES, { dialect: 'postgres' })

  it('reads every table', () => {
    expect(result.diagram.entities.map((e) => e.name).sort()).toEqual(['customer', 'orders'])
  })

  it('unquotes quoted identifiers', () => {
    expect(entity(result.diagram, 'customer')).toBeDefined()
  })

  it('reads an inline primary key', () => {
    expect(entity(result.diagram, 'customer')?.attributes[0]).toMatchObject({
      name: 'id',
      isPrimaryKey: true,
      isNullable: false,
    })
  })

  it('reads a table-level primary key declared after the columns', () => {
    expect(
      entity(result.diagram, 'orders')?.attributes.find((a) => a.name === 'id')?.isPrimaryKey,
    ).toBe(true)
  })

  it('reads NOT NULL and UNIQUE', () => {
    const email = entity(result.diagram, 'customer')?.attributes.find((a) => a.name === 'email')

    expect(email).toMatchObject({ isNullable: false, isUnique: true })
  })

  it('treats an absent NOT NULL as nullable, per SQL', () => {
    expect(
      entity(result.diagram, 'orders')?.attributes.find((a) => a.name === 'total')?.isNullable,
    ).toBe(true)
  })

  it('reads a generated column as a derived attribute', () => {
    // GENERATED ALWAYS AS is exactly what "derived" means in ER terms.
    expect(
      entity(result.diagram, 'customer')?.attributes.find((a) => a.name === 'full_name')?.isDerived,
    ).toBe(true)
  })

  it('normalises long-form type names', () => {
    const email = entity(result.diagram, 'customer')?.attributes.find((a) => a.name === 'email')
    const created = entity(result.diagram, 'customer')?.attributes.find(
      (a) => a.name === 'created_at',
    )

    expect(email?.dataType).toBe('varchar(255)')
    expect(created?.dataType).toBe('timestamptz')
  })

  it('keeps precision in the type', () => {
    expect(
      entity(result.diagram, 'orders')?.attributes.find((a) => a.name === 'total')?.dataType,
    ).toBe('numeric(10,2)')
  })

  it('wires a foreign key declared by ALTER TABLE', () => {
    // Most dumps declare FKs this way so tables can be created in any order.
    const fk = entity(result.diagram, 'orders')?.attributes.find((a) => a.name === 'customer_id')

    expect(fk?.foreignKey?.entityId).toBe(entity(result.diagram, 'customer')?.id)
  })

  it('draws a relationship for the foreign key, parent at the one end', () => {
    expect(result.diagram.relationships).toHaveLength(1)
    const [from, to] = result.diagram.relationships[0]!.participants
    expect(from?.entityId).toBe(entity(result.diagram, 'customer')?.id)
    expect(from?.cardinality).toBe('one')
    expect(to?.cardinality).toBe('many')
  })

  it('reports the statements it ignored rather than failing', () => {
    // A schema dump that is 90% readable should produce 90% of a diagram.
    expect(result.warnings.some((w) => w.includes('ignored'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// MySQL
// ─────────────────────────────────────────────────────────────────────────────

const MYSQL = `
CREATE TABLE \`product\` (
  \`sku\` varchar(32) NOT NULL,
  \`name\` varchar(120) DEFAULT NULL COMMENT 'display name',
  \`price\` decimal(10,2) unsigned NOT NULL,
  PRIMARY KEY (\`sku\`),
  UNIQUE KEY \`name_unique\` (\`name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE \`order_line\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`sku\` varchar(32) NOT NULL,
  \`qty\` int(11) NOT NULL DEFAULT '1',
  PRIMARY KEY (\`id\`),
  KEY \`sku_idx\` (\`sku\`),
  CONSTRAINT \`fk_line_sku\` FOREIGN KEY (\`sku\`) REFERENCES \`product\` (\`sku\`)
) ENGINE=InnoDB;
`

describe('MySQL import', () => {
  const result = importSql(MYSQL, { dialect: 'mysql' })

  it('reads backtick-quoted identifiers', () => {
    expect(result.diagram.entities.map((e) => e.name).sort()).toEqual(['order_line', 'product'])
  })

  it('reads a table-level PRIMARY KEY', () => {
    expect(
      entity(result.diagram, 'product')?.attributes.find((a) => a.name === 'sku')?.isPrimaryKey,
    ).toBe(true)
  })

  it('reads a UNIQUE KEY as unique', () => {
    expect(
      entity(result.diagram, 'product')?.attributes.find((a) => a.name === 'name')?.isUnique,
    ).toBe(true)
  })

  it('drops the meaningless int display width', () => {
    // `int(11)` says nothing about the column; on a diagram it is pure noise.
    expect(
      entity(result.diagram, 'order_line')?.attributes.find((a) => a.name === 'id')?.dataType,
    ).toBe('int')
  })

  it('keeps genuine precision', () => {
    expect(
      entity(result.diagram, 'product')?.attributes.find((a) => a.name === 'price')?.dataType,
    ).toContain('10,2')
  })

  it('reads an inline COMMENT', () => {
    expect(
      entity(result.diagram, 'product')?.attributes.find((a) => a.name === 'name')?.comment,
    ).toBe('display name')
  })

  it('ignores KEY and index clauses without mistaking them for columns', () => {
    expect(entity(result.diagram, 'order_line')?.attributes.map((a) => a.name)).toEqual([
      'id',
      'sku',
      'qty',
    ])
  })

  it('wires a table-level FOREIGN KEY', () => {
    const fk = entity(result.diagram, 'order_line')?.attributes.find((a) => a.name === 'sku')

    expect(fk?.foreignKey?.entityId).toBe(entity(result.diagram, 'product')?.id)
  })
})

describe('SQL import edge cases', () => {
  it('resolves a forward reference to a table defined later', () => {
    const sql = `
      CREATE TABLE a (id int PRIMARY KEY, b_id int REFERENCES b(id));
      CREATE TABLE b (id int PRIMARY KEY);
    `
    const result = importSql(sql)

    expect(result.diagram.relationships).toHaveLength(1)
  })

  it('reports a reference to a table that is not in the file', () => {
    const result = importSql('CREATE TABLE a (id int PRIMARY KEY, x int REFERENCES elsewhere(id));')

    expect(result.diagram.relationships).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('not in this file'))).toBe(true)
  })

  it('marks every column of a composite primary key', () => {
    const result = importSql('CREATE TABLE t (a int, b int, c text, PRIMARY KEY (a, b));')
    const keys = entity(result.diagram, 't')?.attributes.filter((x) => x.isPrimaryKey)

    expect(keys?.map((x) => x.name)).toEqual(['a', 'b'])
  })

  it('draws one relationship per pair of tables, not one per column', () => {
    const sql = `
      CREATE TABLE parent (a int, b int, PRIMARY KEY (a, b));
      CREATE TABLE child (
        a int, b int,
        FOREIGN KEY (a) REFERENCES parent(a),
        FOREIGN KEY (b) REFERENCES parent(b)
      );
    `

    expect(importSql(sql).diagram.relationships).toHaveLength(1)
  })

  it('handles IF NOT EXISTS and schema-qualified names', () => {
    const result = importSql('CREATE TABLE IF NOT EXISTS public."my table" (id int);')

    expect(result.diagram.entities[0]?.name).toBe('my table')
  })

  it('fails loudly when there is nothing to read', () => {
    expect(() => importSql('SELECT 1;')).toThrow(/No CREATE TABLE/)
  })

  it('names the dialect it used', () => {
    expect(importSql(MYSQL).warnings[0]).toContain('MySQL')
    expect(importSql(POSTGRES).warnings[0]).toContain('PostgreSQL')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Mermaid
// ─────────────────────────────────────────────────────────────────────────────

describe('Mermaid import', () => {
  const MMD = `
%% a comment
erDiagram
  CUSTOMER {
    uuid id PK
    varchar_255_ email UK "nullable"
    text phones "multivalued; nullable"
  }
  ORDER {
    uuid id PK
    uuid customer_id FK "nullable"
  }
  CUSTOMER ||--o{ ORDER : "places"
`

  it('reads entities and their fields', () => {
    const result = importMermaid(MMD)

    expect(result.diagram.entities.map((e) => e.name).sort()).toEqual(['CUSTOMER', 'ORDER'])
    expect(entity(result.diagram, 'CUSTOMER')?.attributes).toHaveLength(3)
  })

  it('reads key markers', () => {
    const customer = entity(importMermaid(MMD).diagram, 'CUSTOMER')

    expect(customer?.attributes[0]).toMatchObject({ name: 'id', isPrimaryKey: true })
    expect(customer?.attributes[1]?.isUnique).toBe(true)
  })

  it('recovers the Chen flags our exporter wrote into comments', () => {
    const phones = entity(importMermaid(MMD).diagram, 'CUSTOMER')?.attributes[2]

    expect(phones?.isMultivalued).toBe(true)
    // The flag should not also survive as literal comment text.
    expect(phones?.comment).toBeUndefined()
  })

  it('reads cardinality rather than defaulting it', () => {
    // Defaulting would quietly rewrite every many-to-many into a one-to-many.
    const manyToMany = importMermaid('erDiagram\n  A }o..o{ B : "x"\n')
    const [from, to] = manyToMany.diagram.relationships[0]!.participants

    expect(from?.cardinality).toBe('many')
    expect(to?.cardinality).toBe('many')
  })

  it('reads solid as identifying and dotted as not', () => {
    expect(
      importMermaid('erDiagram\n  A ||--o{ B : "x"\n').diagram.relationships[0]?.isIdentifying,
    ).toBe(true)
    expect(
      importMermaid('erDiagram\n  A ||..o{ B : "x"\n').diagram.relationships[0]?.isIdentifying,
    ).toBe(false)
  })

  it('creates entities named only by a relationship', () => {
    expect(importMermaid('erDiagram\n  A ||--o{ B : "x"\n').diagram.entities).toHaveLength(2)
  })

  it('rejects a file that is not a Mermaid ER diagram', () => {
    expect(() => importMermaid('graph TD\n A --> B')).toThrow(/erDiagram/)
  })

  it('warns that the layout had to be invented', () => {
    expect(importMermaid(MMD).warnings[0]).toContain('no layout')
  })
})

describe('Mermaid round trip', () => {
  it('anything this tool writes, it can read back', () => {
    const original = importSql(POSTGRES).diagram
    const exported = exportMermaid(original).content
    const reimported = importMermaid(exported).diagram

    expect(reimported.entities).toHaveLength(original.entities.length)
    expect(reimported.relationships).toHaveLength(original.relationships.length)

    const orders = entity(reimported, 'orders')
    expect(orders?.attributes.map((a) => a.name)).toEqual(['id', 'customer_id', 'total'])
    expect(orders?.attributes[0]?.isPrimaryKey).toBe(true)
  })

  it('does not gain a relationship label that was never there', () => {
    // The exporter writes "relates to" for an unnamed relationship; reading that back as
    // a real name would make a round trip drift.
    const exported = exportMermaid(
      importSql('CREATE TABLE a (id int PRIMARY KEY); CREATE TABLE b (a_id int REFERENCES a(id));')
        .diagram,
    ).content

    expect(importMermaid(exported).diagram.relationships[0]?.name).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Routing
// ─────────────────────────────────────────────────────────────────────────────

describe('choosing an importer by filename', () => {
  it('routes .sql', () => {
    const outcome = importFile({ filename: 'schema.sql', content: POSTGRES, dialect: 'auto' })

    expect(outcome.diagram.entities).toHaveLength(2)
  })

  it('names the diagram after the file', () => {
    const outcome = importFile({ filename: 'shop.sql', content: POSTGRES, dialect: 'auto' })

    expect(outcome.diagram.name).toBe('shop')
  })

  it('honours an explicit dialect over detection', () => {
    const outcome = importFile({ filename: 'schema.sql', content: MYSQL, dialect: 'postgres' })

    expect(outcome.warnings[0]).toContain('PostgreSQL')
  })

  it('routes .mmd', () => {
    const outcome = importFile({
      filename: 'diagram.mmd',
      content: 'erDiagram\n  A ||--o{ B : "x"\n',
      dialect: 'auto',
    })

    expect(outcome.diagram.entities).toHaveLength(2)
  })

  it('routes .erd.json', () => {
    const source = importSql(POSTGRES).diagram
    const outcome = importFile({
      filename: 'saved.erd.json',
      content: JSON.stringify(source),
      dialect: 'auto',
    })

    expect(outcome.diagram.id).toBe(source.id)
  })

  it('refuses an unknown extension with a readable message', () => {
    expect(() => importFile({ filename: 'notes.txt', content: 'x', dialect: 'auto' })).toThrow(
      /\.erd\.json, \.mmd and \.sql/,
    )
  })

  it('asks for layout only when the file carries none', () => {
    // .erd.json has positions; .sql and .mmd never do.
    expect(needsLayout(importSql(POSTGRES).diagram)).toBe(true)
  })
})
