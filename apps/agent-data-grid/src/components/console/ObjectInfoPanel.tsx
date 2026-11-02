import { useState } from 'react'

import { Icon, IconButton, Input, Tabs } from '@/ui'

export interface ObjectInfoPanelProps {
  objectName: string
}

interface ColumnInfo {
  name: string
  type: string
}

interface NamedInfo {
  name: string
  kind: string
}

const PANEL = {
  display: 'flex',
  flexDirection: 'column',
  flex: 'none',
  width: 280,
  height: '100%',
  background: 'var(--bg-editor)',
  borderLeft: '1px solid var(--border)',
  overflow: 'hidden',
} as const

const HEADER = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flex: 'none',
  height: 28,
  padding: '0 8px',
  background: 'var(--bg-elev)',
  borderBottom: '1px solid var(--border)',
} as const

const HEADER_TITLE = {
  fontSize: 'var(--fs-ui)',
  fontWeight: 500,
  color: 'var(--fg-strong)',
} as const

const SUMMARY = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 'none',
  height: 44,
  padding: '0 12px',
  boxSizing: 'border-box',
} as const

const OBJECT_ICON = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 32,
  height: 32,
  borderRadius: 'var(--radius-control)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
} as const

const OBJECT_NAME = {
  fontSize: 'var(--fs-ui)',
  fontWeight: 500,
  color: 'var(--fg-strong)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const OBJECT_KIND = {
  fontSize: 'var(--fs-small)',
  color: 'var(--fg-muted)',
} as const

const CONTENT = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '8px 12px',
} as const

const FILTER = {
  width: '100%',
  marginBottom: 6,
  fontSize: 'var(--fs-small)',
} as const

const TABLE = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--fs-small)',
  tableLayout: 'fixed',
} as const

const TH = {
  border: '1px solid var(--border)',
  padding: '2px 6px',
  textAlign: 'left',
  fontWeight: 500,
  color: 'var(--fg-strong)',
  background: 'var(--bg-elev)',
} as const

const TD = {
  border: '1px solid var(--border)',
  padding: '2px 6px',
  color: 'var(--fg)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const LIST_ROW = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '3px 0',
  fontSize: 'var(--fs-small)',
  color: 'var(--fg)',
} as const

const KIND_TAG = {
  flex: 'none',
  padding: '0 6px',
  borderRadius: 'var(--radius-small)',
  border: '1px solid var(--border)',
  background: 'var(--bg-elev)',
  color: 'var(--fg-secondary)',
  fontSize: 'var(--fs-tiny)',
  lineHeight: '16px',
} as const

const COLUMNS: ColumnInfo[] = [
  { name: 'id', type: 'int4' },
  { name: 'full_name', type: 'varchar' },
  { name: 'email', type: 'varchar' },
  { name: 'plan_id', type: 'int4' },
  { name: 'status', type: 'varchar' },
  { name: 'created_at', type: 'timestamptz' },
]

const CONSTRAINTS: NamedInfo[] = [
  { name: 'users_pkey', kind: '主键' },
  { name: 'users_plan_id_fkey', kind: '外键' },
  { name: 'users_email_unique', kind: '唯一' },
]

const INDEXES: NamedInfo[] = [
  { name: 'users_pkey', kind: '主键' },
  { name: 'users_email_idx', kind: '唯一' },
  { name: 'users_created_at_idx', kind: '普通' },
]

const TAB_ITEMS = [
  { id: 'columns', label: '列' },
  { id: 'constraints', label: '约束' },
  { id: 'indexes', label: '索引' },
]

/**
 * Object Info tool window: the summary of the selected database object plus
 * its columns, constraints and indexes.
 */
export function ObjectInfoPanel({ objectName }: ObjectInfoPanelProps) {
  const [tab, setTab] = useState('columns')
  const [filter, setFilter] = useState('')

  const match = (text: string) => text.toLowerCase().includes(filter.trim().toLowerCase())
  const columns = COLUMNS.filter((c) => match(c.name) || match(c.type))
  const constraints = CONSTRAINTS.filter((c) => match(c.name) || match(c.kind))
  const indexes = INDEXES.filter((c) => match(c.name) || match(c.kind))

  return (
    <aside style={PANEL} aria-label="对象信息">
      <div style={HEADER}>
        <span style={HEADER_TITLE}>对象信息</span>
        <IconButton icon="more" title="Object Info options" size="small" iconSize={14} />
      </div>

      <div style={SUMMARY}>
        <span style={OBJECT_ICON}>
          <Icon name="db-table" size={16} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={OBJECT_NAME}>{objectName}</span>
          <span style={OBJECT_KIND}>表</span>
        </span>
      </div>

      <Tabs items={TAB_ITEMS} activeId={tab} onSelect={setTab} variant="compact" />

      <div style={CONTENT}>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="筛选"
          aria-label="筛选对象属性"
          variant="framed"
          style={FILTER}
        />
        {tab === 'columns' && (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>名称</th>
                <th style={TH}>类型</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name}>
                  <td style={TD} title={column.name}>
                    {column.name}
                  </td>
                  <td style={TD} title={column.type}>
                    {column.type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'constraints' && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {constraints.map((item) => (
              <li key={item.name} style={LIST_ROW}>
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {item.name}
                </span>
                <span style={KIND_TAG}>{item.kind}</span>
              </li>
            ))}
          </ul>
        )}

        {tab === 'indexes' && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {indexes.map((item) => (
              <li key={item.name} style={LIST_ROW}>
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {item.name}
                </span>
                <span style={KIND_TAG}>{item.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
