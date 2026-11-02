import { useState } from 'react'

import { Button, Checkbox, IconButton, Select, type SelectOption } from '@/ui'

export interface AppToolbarProps {
  dataSource: string
}

const ALTERNATE_DATA_SOURCES = [
  'PostgreSQL - Staging Warehouse @ staging.internal:5432',
  'PostgreSQL - Local Sandbox @ localhost:5433',
]

const LIMIT_OPTIONS: SelectOption[] = [
  { value: '100', label: '100 行' },
  { value: '500', label: '500 行' },
  { value: '1000', label: '1000 行' },
  { value: 'all', label: '无限制' },
]

const TOOLBAR_ACTIONS = [
  { icon: 'plus', title: '新建查询' },
  { icon: 'refresh', title: '刷新' },
  { icon: 'run', title: '执行' },
  { icon: 'stop', title: '停止' },
  { icon: 'star-outline', title: '收藏' },
] as const

export function AppToolbar({ dataSource }: AppToolbarProps) {
  const [activeDataSource, setActiveDataSource] = useState(dataSource)
  const [autoCommit, setAutoCommit] = useState(true)
  const [limit, setLimit] = useState('100')

  const dataSourceOptions: SelectOption[] = [
    { value: dataSource, label: dataSource, icon: 'database' },
    ...ALTERNATE_DATA_SOURCES.map((name) => ({ value: name, label: name, icon: 'database' })),
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flex: 'none',
        height: 36,
        padding: '0 8px',
        background: 'var(--bg-app)',
        borderBottom: '1px solid var(--border)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '0 1 auto' }}>
        <div style={{ minWidth: 0, maxWidth: 320, display: 'inline-flex', overflow: 'hidden' }}>
          <Select
            value={activeDataSource}
            options={dataSourceOptions}
            onChange={setActiveDataSource}
            aria-label="数据源"
          />
        </div>

        {TOOLBAR_ACTIONS.map((action) => (
          <IconButton
            key={action.title}
            icon={action.icon}
            title={action.title}
            size="normal"
            iconSize={16}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              color: 'var(--fg-secondary)',
            }}
          />
        ))}
      </div>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flex: 'none' }}
      >
        <Checkbox checked={autoCommit} onChange={setAutoCommit} label="自动提交" />
        <Select
          value={limit}
          options={LIMIT_OPTIONS}
          onChange={setLimit}
          aria-label="限制 100 行"
          renderValue={(option) =>
            option ? (option.value === 'all' ? '限制：无限制' : `限制 ${option.label}`) : '限制'
          }
        />
        <Button size="small" icon="settings">
          设置
        </Button>
      </div>
    </div>
  )
}
