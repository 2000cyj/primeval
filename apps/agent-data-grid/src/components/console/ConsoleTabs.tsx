import { useState, type CSSProperties } from 'react'

import { Icon, IconButton } from '@/ui'

export interface ConsoleTabsProps {
  /** Id of the selected console tab. */
  active: string
  onActiveChange: (id: string) => void
}

interface TabItem {
  id: string
  label: string
}

const STRIP: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  height: 32,
  minHeight: 32,
  background: 'var(--bg-elev)',
  borderBottom: '1px solid var(--border)',
  paddingLeft: 4,
  overflow: 'hidden',
}

const TAB: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: '100%',
  padding: '0 12px',
  fontSize: 'var(--fs-ui)',
  whiteSpace: 'nowrap',
  cursor: 'default',
  borderTop: '2px solid transparent',
  background: 'transparent',
  color: 'var(--fg-secondary)',
}

const CLOSE_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  borderRadius: 'var(--radius-small)',
  color: 'var(--fg-muted)',
  cursor: 'default',
}

/**
 * Flat console tab strip: the selected tab is white with a 2px accent line on
 * top, the others sit on the strip background. The trailing `+` opens a new
 * console; the close glyph on the inactive tab closes it.
 */
export function ConsoleTabs({ active, onActiveChange }: ConsoleTabsProps) {
  const [tabs, setTabs] = useState<TabItem[]>([
    { id: 'query-1', label: 'Query 1' },
    { id: 'customer_growth.sql', label: 'customer_growth.sql' },
  ])
  const [counter, setCounter] = useState(1)
  const [hovered, setHovered] = useState<string | null>(null)

  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const next = tabs.filter((tab) => tab.id !== id)
    setTabs(next)
    if (active === id) {
      const fallback = next[index] ?? next[index - 1]
      if (fallback) onActiveChange(fallback.id)
    }
  }

  const addTab = () => {
    const count = counter + 1
    setCounter(count)
    const id = `query-${count}`
    setTabs((prev) => [...prev, { id, label: `Query ${count}` }])
    onActiveChange(id)
  }

  return (
    <div style={STRIP} role="tablist" aria-label="Console tabs">
      {tabs.map((tab) => {
        const selected = tab.id === active
        const style: CSSProperties = {
          ...TAB,
          background: selected
            ? 'var(--bg-island)'
            : hovered === tab.id
              ? 'var(--bg-toolbar-hover)'
              : 'transparent',
          color: selected ? 'var(--fg-strong)' : 'var(--fg-secondary)',
          borderTopColor: selected ? 'var(--accent)' : 'transparent',
        }
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            style={style}
            onMouseEnter={() => setHovered(tab.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onActiveChange(tab.id)}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.label}</span>
            {!selected && (
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                title={`Close ${tab.label}`}
                style={CLOSE_BUTTON}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        )
      })}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px 0 6px' }}>
        <IconButton icon="plus" title="New Console" size="small" onClick={addTab} />
      </div>
    </div>
  )
}
