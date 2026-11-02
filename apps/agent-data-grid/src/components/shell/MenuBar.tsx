import { useRef, useState } from 'react'

import { Button, Menu, type MenuItem } from '@/ui'

interface MenuDefinition {
  label: string
  items: MenuItem[]
}

const MENUS: MenuDefinition[] = [
  {
    label: 'File',
    items: [
      { kind: 'item', id: 'file.new-query', label: 'New Query' },
      { kind: 'item', id: 'file.new-datasource', label: 'New Data Source' },
      { kind: 'item', id: 'file.drivers', label: 'Data Sources and Drivers' },
      { kind: 'item', id: 'file.close-project', label: 'Close Project' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { kind: 'item', id: 'edit.undo', label: 'Undo' },
      { kind: 'item', id: 'edit.redo', label: 'Redo' },
      { kind: 'item', id: 'edit.copy', label: 'Copy' },
      { kind: 'item', id: 'edit.paste', label: 'Paste' },
    ],
  },
  {
    label: 'View',
    items: [
      { kind: 'item', id: 'view.tool-windows', label: 'Tool Windows' },
      { kind: 'item', id: 'view.database-objects', label: 'Database Objects' },
      { kind: 'item', id: 'view.appearance', label: 'Appearance' },
    ],
  },
  {
    label: 'Navigate',
    items: [
      { kind: 'item', id: 'navigate.back', label: 'Back' },
      { kind: 'item', id: 'navigate.forward', label: 'Forward' },
      { kind: 'item', id: 'navigate.goto-file', label: 'Go to File' },
      { kind: 'item', id: 'navigate.recent-files', label: 'Recent Files' },
    ],
  },
  {
    label: 'Query',
    items: [
      { kind: 'item', id: 'query.run', label: 'Run' },
      { kind: 'item', id: 'query.explain', label: 'Explain Plan' },
      { kind: 'item', id: 'query.stop', label: 'Stop' },
      { kind: 'item', id: 'query.execute-to-file', label: 'Execute to File' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { kind: 'item', id: 'tools.sql-scripts', label: 'SQL Scripts' },
      { kind: 'item', id: 'tools.data-transfer', label: 'Data Transfer…' },
      { kind: 'item', id: 'tools.settings', label: 'Settings' },
    ],
  },
  {
    label: 'Window',
    items: [
      { kind: 'item', id: 'window.tool-windows', label: 'Tool Windows' },
      { kind: 'item', id: 'window.recent-projects', label: 'Recent Projects' },
      { kind: 'item', id: 'window.restore-layout', label: 'Restore Default Layout' },
    ],
  },
  {
    label: 'Help',
    items: [
      { kind: 'item', id: 'help.find-action', label: 'Find Action' },
      { kind: 'item', id: 'help.documentation', label: 'Documentation' },
      { kind: 'item', id: 'help.about', label: 'About' },
    ],
  },
]

export function MenuBar() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const anchors = useRef<Array<HTMLButtonElement | null>>([])

  return (
    <div
      role="menubar"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        flex: 'none',
        height: 28,
        padding: '0 4px',
        background: 'var(--bg-app)',
        borderBottom: '1px solid var(--border)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      {MENUS.map((menu, index) => (
        <Button
          key={menu.label}
          ref={(element) => {
            anchors.current[index] = element
          }}
          variant="ghost"
          size="small"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openIndex === index}
          onClick={() => setOpenIndex(openIndex === index ? null : index)}
          style={{
            height: 24,
            padding: '0 8px',
            fontSize: 13,
            borderRadius: 'var(--radius-small)',
            color: openIndex === index ? 'var(--fg-strong)' : 'var(--fg)',
          }}
        >
          {menu.label}
        </Button>
      ))}

      {MENUS.map((menu, index) => (
        <Menu
          key={`${menu.label}-menu`}
          open={openIndex === index}
          onClose={() => setOpenIndex(null)}
          anchor={anchors.current[index] ?? null}
          items={menu.items}
          placement="bottom-start"
          aria-label={menu.label}
        />
      ))}
    </div>
  )
}
