import { IconButton, TooltipHost } from '@/ui'

export interface ToolWindowBarProps {
  active: string
  onActiveChange: (value: string) => void
}

const TOOL_WINDOWS = [
  { id: 'project', label: '项目', icon: 'toolwindow-project' },
  { id: 'structure', label: '结构', icon: 'toolwindow-structure' },
  { id: 'database', label: '数据库', icon: 'toolwindow-database' },
  { id: 'services', label: '服务', icon: 'toolwindow-services' },
  { id: 'terminal', label: '终端', icon: 'toolwindow-terminal' },
] as const

const ACCENT = 'var(--fg-accent, var(--accent, #3574f0))'

export function ToolWindowBar({ active, onActiveChange }: ToolWindowBarProps) {
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        flex: 'none',
        width: 40,
        padding: '4px 0',
        background: 'var(--bg-app)',
        borderRight: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {TOOL_WINDOWS.map((tool, index) => {
        const selected = active === tool.id
        const isLast = index === TOOL_WINDOWS.length - 1
        return (
          <IconButton
            key={tool.id}
            icon={tool.icon}
            title={tool.label}
            size="large"
            iconSize={20}
            pressed={selected}
            aria-label={tool.label}
            onClick={() => onActiveChange(tool.id)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-toolbar-button)',
              marginTop: isLast ? 'auto' : undefined,
              background: selected ? 'var(--bg-elev)' : 'transparent',
              color: selected ? ACCENT : 'var(--fg-muted)',
            }}
          />
        )
      })}
      <TooltipHost />
    </div>
  )
}
