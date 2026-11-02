import { useRef, useState, type CSSProperties } from 'react'

import { Button, Checkbox, Icon, Menu, Select, type MenuItem } from '@/ui'

export interface ConsoleToolbarProps {
  autoCommit: boolean
  onAutoCommitChange: (value: boolean) => void
  limit: number
  onLimitChange: (value: number) => void
}

const BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  minHeight: 36,
  padding: '0 8px',
  background: 'var(--bg-editor)',
  borderBottom: '1px solid var(--border)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
}

const DIVIDER: CSSProperties = {
  width: 1,
  height: 18,
  flex: 'none',
  background: 'var(--border-strong)',
}

const LIMIT_SELECT: CSSProperties = {
  width: 130,
  flex: 'none',
}

/** IDEA's green "Run" button colour, applied through the Button's own tokens. */
const RUN_THEME = {
  '--bg-button-primary': 'var(--fg-success, var(--success, #359548))',
  '--bg-button-primary-hover':
    'color-mix(in srgb, var(--fg-success, var(--success, #359548)) 86%, var(--fg-strong))',
} as CSSProperties

const LIMIT_OPTIONS = [
  { value: '100', label: '限制 100 行' },
  { value: '500', label: '限制 500 行' },
  { value: '1000', label: '限制 1000 行' },
  { value: '0', label: '无限制' },
]

/**
 * Console toolbar: run / stop, the auto-commit switch, the row limit and the
 * explain-plan action.
 */
export function ConsoleToolbar({
  autoCommit,
  onAutoCommitChange,
  limit,
  onLimitChange,
}: ConsoleToolbarProps) {
  const [running, setRunning] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const caretRef = useRef<HTMLButtonElement>(null)

  const runItems: MenuItem[] = [
    { kind: 'item', id: 'run', label: '执行', run: () => setRunning(true) },
    { kind: 'item', id: 'run-all', label: '执行全部', run: () => setRunning(true) },
    { kind: 'item', id: 'run-to-cursor', label: '运行到光标处', run: () => setRunning(true) },
  ]

  return (
    <div style={BAR} role="toolbar" aria-label="Console toolbar">
      <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
        <Button
          variant="primary"
          size="small"
          icon="run"
          style={RUN_THEME}
          onClick={() => setRunning(true)}
        >
          {running ? '运行中' : '执行'}
        </Button>
        <Button
          variant="primary"
          size="small"
          aria-label="Run variants"
          title="Run variants"
          style={{ ...RUN_THEME, paddingLeft: 4, paddingRight: 4, minWidth: 0 }}
          ref={caretRef}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="chevron-down" size={12} />
        </Button>
        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchor={caretRef}
          items={runItems}
          placement="bottom-start"
          aria-label="Run"
        />
      </div>

      <Button variant="ghost" size="small" icon="stop" onClick={() => setRunning(false)}>
        停止
      </Button>

      <span style={DIVIDER} aria-hidden />

      <Checkbox checked={autoCommit} onChange={onAutoCommitChange} label="自动提交" />

      <div style={LIMIT_SELECT}>
        <Select
          value={String(limit)}
          options={LIMIT_OPTIONS}
          onChange={(value) => onLimitChange(Number(value))}
          aria-label="限制行数"
        />
      </div>

      <Button variant="ghost" size="small">
        解释计划
      </Button>
    </div>
  )
}
