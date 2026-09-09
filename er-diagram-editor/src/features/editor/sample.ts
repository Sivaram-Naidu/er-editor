// The onboarding sample (FR-9.4). A schema small enough to read at a glance and varied
// enough to show every V1 notation cue: a weak entity, an identifying relationship,
// primary and foreign keys, a unique field, a derived field, and a multivalued field.

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
} from '../../domain'

export function buildSampleDiagram(): Diagram {
  const customerId = createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })
  const customer = createEntity({
    name: 'CUSTOMER',
    attributes: [
      customerId,
      createAttribute({ name: 'email', dataType: 'varchar(255)', isUnique: true }),
      createAttribute({ name: 'phone_numbers', dataType: 'varchar(20)', isMultivalued: true }),
    ],
  })

  const orderId = createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })
  const order = createEntity({
    name: 'ORDER',
    attributes: [
      orderId,
      {
        ...createAttribute({ name: 'customer_id', dataType: 'uuid' }),
        foreignKey: { entityId: customer.id, attributeId: customerId.id },
      },
      createAttribute({ name: 'placed_at', dataType: 'timestamptz' }),
      createAttribute({ name: 'total', dataType: 'numeric(10,2)', isDerived: true }),
    ],
  })

  // A line item has no identity of its own — it is identified through its order, which
  // is exactly what makes it weak and the relationship identifying.
  const line = createEntity({
    name: 'ORDER_LINE',
    kind: 'weak',
    attributes: [
      createAttribute({ name: 'line_no', dataType: 'int', isPrimaryKey: true }),
      {
        ...createAttribute({ name: 'order_id', dataType: 'uuid' }),
        foreignKey: { entityId: order.id, attributeId: orderId.id },
      },
      createAttribute({ name: 'quantity', dataType: 'int' }),
    ],
  })

  const productId = createAttribute({ name: 'sku', dataType: 'varchar(32)', isPrimaryKey: true })
  const product = createEntity({
    name: 'PRODUCT',
    attributes: [
      productId,
      createAttribute({ name: 'name', dataType: 'varchar(120)' }),
      createAttribute({ name: 'unit_price', dataType: 'numeric(10,2)' }),
    ],
  })

  return {
    ...createDiagram({
      name: 'Sample shop',
      entities: [customer, order, line, product],
      relationships: [
        createRelationship({ from: customer.id, to: order.id, name: 'places' }),
        createRelationship({
          from: order.id,
          to: line.id,
          name: 'contains',
          isIdentifying: true,
          toEnd: { cardinality: 'many', participation: 'total' },
        }),
        createRelationship({ from: product.id, to: line.id, name: 'appears in' }),
      ],
    }),
    layout: {
      positions: {
        [customer.id]: { x: 0, y: 0 },
        [order.id]: { x: 320, y: 0 },
        [line.id]: { x: 640, y: 0 },
        [product.id]: { x: 640, y: 260 },
      },
      pinned: [],
    },
  }
}
