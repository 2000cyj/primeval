import { useState, type CSSProperties } from 'react'
import { Icon, type IconName } from '@/ui'
import { RESULT_ROWS, type ResultStatus } from '@/data/resultRows'

type ResultTabId = 'table' | 'tree' | 'output' | 'plan' | 'messages'

interface ResultTab {
  id: ResultTabId
  label: string
  icon: IconName
}

const TABS: ResultTab[] = [
  { id: 'table', label: '表格', icon: 'db-table' },
  { id: 'tree', label: '树', icon: 'toolwindow-structure' },
  { id: 'output', label: '输出', icon: 'db-console' },
  { id: 'plan', label: '解释计划', icon: 'db-plan' },
  { id: 'messages', label: '消息', icon: 'toolwindow-notifications' },
]

const COLUMNS: { key: string; label: string; width: number }[] = [
  { key: 'index', label: '#', width: 44 },
  { key: 'id', label: 'id', width: 72 },
  { key: 'full_name', label: 'full_name', width: 150 },
  { key: 'email', label: 'email', width: 220 },
  { key: 'plan', label: 'plan', width: 110 },
  { key: 'status', label: 'status', width: 110 },
  { key: 'created_at', label: 'created_at', width: 190 },
]

/** 状态点颜色：Active 绿 / Pending 橙 / Inactive 灰。 */
const STATUS_COLOR: Record<ResultStatus, string> = {
  Active: 'var(--fg-success, #359548)',
  Pending: 'var(--fg-warning, #db6b00)',
  Inactive: 'var(--fg-muted)',
}

const ROW_COUNT = RESULT_ROWS.length
const ELAPSED_MS = 42

export function ResultsPanel() {
  const [activeTab, setActiveTab] = useState<ResultTabId>('table')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div style={rootStyle}>
      {/* 工具窗口头：结果页签 + 行数统计 */}
      <div style={headerStyle}>
        {TABS.map((tab) => {
          const selected = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...tabStyle,
                color: selected ? 'var(--fg)' : 'var(--fg-muted)',
                borderBottom: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              <Icon name={tab.icon} size={13} />
              <span>{tab.label}</span>
            </button>
          )
        })}
        <div style={headerSpacerStyle} />
        <span style={statsStyle}>{`已获取 ${ROW_COUNT} 行，用时 ${ELAPSED_MS} 毫秒`}</span>
      </div>

      {/* 结果表格 */}
      <div style={bodyStyle}>
        <table style={tableStyle}>
          <colgroup>
            {COLUMNS.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    ...thStyle,
                    textAlign: col.key === 'index' ? 'center' : 'left',
                    width: col.width,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESULT_ROWS.map((row) => (
              <tr
                key={row.index}
                onMouseEnter={() => setHoveredIndex(row.index)}
                onMouseLeave={() =>
                  setHoveredIndex((current) => (current === row.index ? null : current))
                }
                style={{
                  ...trStyle,
                  background: hoveredIndex === row.index ? 'var(--bg-hover)' : 'transparent',
                }}
              >
                <td style={{ ...tdStyle, ...indexCellStyle }}>{row.index}</td>
                <td style={tdStyle}>{row.id}</td>
                <td style={tdStyle}>{row.full_name}</td>
                <td style={tdStyle}>{row.email}</td>
                <td style={tdStyle}>{row.plan}</td>
                <td style={tdStyle}>
                  <span style={statusCellStyle}>
                    <span style={statusDotStyle(STATUS_COLOR[row.status])} />
                    <span>{row.status}</span>
                  </span>
                </td>
                <td style={tdStyle}>{row.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  background: 'var(--bg-app)',
  color: 'var(--fg)',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--fs-ui)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  flex: 'none',
  height: 'var(--h-tab, 28px)',
  paddingLeft: 4,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-app)',
}

const tabStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: '100%',
  padding: '0 8px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
}

const headerSpacerStyle: CSSProperties = {
  flex: 1,
}

const statsStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  paddingRight: 10,
  color: 'var(--fg-muted)',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
}

const tableStyle: CSSProperties = {
  width: '100%',
  tableLayout: 'fixed',
  borderCollapse: 'collapse',
  fontSize: 12,
  color: 'var(--fg)',
}

const thStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  height: 26,
  padding: '0 8px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-panel, var(--bg-elev))',
  color: 'var(--fg)',
  fontSize: 13,
  fontWeight: 500,
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const trStyle: CSSProperties = {
  height: 24,
}

const tdStyle: CSSProperties = {
  height: 24,
  padding: '0 8px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--fg)',
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const indexCellStyle: CSSProperties = {
  textAlign: 'center',
  color: 'var(--fg-muted)',
}

const statusCellStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const statusDotStyle = (color: string): CSSProperties => ({
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: color,
})
