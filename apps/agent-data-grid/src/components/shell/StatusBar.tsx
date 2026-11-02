import type { CSSProperties } from 'react'

export interface StatusBarProps {
  connection: string
  serverVersion: string
  transaction: string
}

const separatorStyle: CSSProperties = {
  width: 1,
  height: 12,
  flex: 'none',
  background: 'var(--border)',
}

export function StatusBar({ connection, serverVersion, transaction }: StatusBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flex: 'none',
        height: 24,
        padding: '0 8px',
        background: 'var(--bg-app)',
        borderTop: '1px solid var(--border)',
        fontSize: 12,
        lineHeight: 1,
        color: 'var(--fg-muted)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{connection}</span>
        <span style={separatorStyle} />
        <span>{serverVersion}</span>
        <span style={separatorStyle} />
        <span>{transaction}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--success, #359548)',
            }}
          />
          就绪
        </span>
        <span style={separatorStyle} />
        <span>UTF-8</span>
        <span style={separatorStyle} />
        <span>LF</span>
        <span style={separatorStyle} />
        <span>SQL</span>
      </div>
    </div>
  )
}
