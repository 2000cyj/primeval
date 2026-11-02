/**
 * 左栏：Database Explorer（数据库树）+ Services（服务树）两个工具窗口面板。
 *
 * - 全部使用仓库内移植的 openidea UI 套件：Tree（虚拟化）/ Input / IconButton / Icon。
 * - 颜色一律走主题变量（var(--fg-*)、var(--bg-*)、var(--border*)），不写死色值。
 * - 组件无 props、无导出（见 SPEC §12）。
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { Icon, IconButton, Input, Tree } from '@/ui'
import {
  DATA_SOURCE_TREE,
  SERVICES_TREE,
  type DbTreeNode,
  type ServiceNode,
} from '@/data/dataSources'

/** 默认展开到 users：其所有祖先节点 id。 */
const DEFAULT_EXPANDED = [
  'acme-production',
  'acme-customer-analytics',
  'acme-customer-analytics-schemas',
  'acme-customer-analytics-public',
  'acme-customer-analytics-public-tables',
]

const DEFAULT_SELECTED = 'users'

/** 搜索：保留匹配节点及其祖先；匹配节点自身保留整个子树。 */
function filterNodes(nodes: DbTreeNode[], query: string): DbTreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const out: DbTreeNode[] = []
  for (const node of nodes) {
    if (node.label.toLowerCase().includes(q)) {
      out.push(node)
      continue
    }
    const children = node.children ? filterNodes(node.children, query) : undefined
    if (children && children.length > 0) out.push({ ...node, children })
  }
  return out
}

function collectIds(nodes: DbTreeNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    ids.push(node.id)
    if (node.children) ids.push(...collectIds(node.children))
  }
  return ids
}

const rootStyle: CSSProperties = {
  width: 260,
  flex: '0 0 260px',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  borderRight: '1px solid var(--border)',
  background: 'var(--bg-app)',
  color: 'var(--fg)',
  fontSize: 13,
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  minWidth: 0,
}

const databasePanelStyle: CSSProperties = {
  ...panelStyle,
  flex: '1 1 auto',
}

const servicesPanelStyle: CSSProperties = {
  ...panelStyle,
  flex: '0 0 180px',
  height: 180,
  borderTop: '1px solid var(--border)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 4,
  flex: 'none',
  height: 28,
  padding: '0 4px 0 8px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fg-strong)',
}

const headerActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 'none',
  padding: '2px 6px 6px',
}

const treeBoxStyle: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
}

const dotStyle: CSSProperties = {
  flex: 'none',
  width: 6,
  height: 6,
  borderRadius: '50%',
}

const serviceRowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  color: 'var(--fg-strong)',
}

const serviceLabelStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export function DatabaseExplorer() {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_EXPANDED))
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set([DEFAULT_SELECTED]))
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => filterNodes(DATA_SOURCE_TREE, query), [query])

  /** 搜索时自动展开命中路径，否则保持用户自己的展开状态。 */
  const effectiveExpanded = useMemo(() => {
    if (!query.trim()) return expanded
    return new Set(collectIds(filtered))
  }, [query, filtered, expanded])

  const renderServiceNode = (node: ServiceNode): ReactNode => (
    <span style={serviceRowStyle}>
      {node.status ? (
        <span
          style={{
            ...dotStyle,
            background: node.status === 'ok' ? 'var(--fg-success, #359548)' : 'var(--fg-muted)',
          }}
        />
      ) : null}
      <span style={serviceLabelStyle}>{node.label}</span>
    </span>
  )

  return (
    <aside style={rootStyle}>
      {/* 上半：Database 面板 */}
      <section style={databasePanelStyle}>
        <div style={headerStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="toolwindow-database" size={14} />
            Database
          </span>
          <div style={headerActionsStyle}>
            <IconButton icon="db-add" title="新建数据源" size="small" onClick={() => undefined} />
            <IconButton icon="refresh" title="刷新" size="small" onClick={() => undefined} />
            <IconButton
              icon="collapse-all"
              title="全部折叠"
              size="small"
              onClick={() => undefined}
            />
          </div>
        </div>

        <div style={toolbarStyle}>
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对象"
            aria-label="搜索对象"
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
          <IconButton
            icon="search"
            title="在树中查找"
            size="small"
            onClick={() => searchRef.current?.focus()}
          />
        </div>

        <div style={treeBoxStyle}>
          <Tree<DbTreeNode>
            roots={filtered}
            getKey={(node) => node.id}
            getLabel={(node) => node.label}
            getChildren={(node) => node.children}
            isExpandable={(node) => !!node.children && node.children.length > 0}
            getIcon={(node) => node.icon}
            getDetail={(node) => node.detail}
            expanded={effectiveExpanded}
            selected={selected}
            onExpandedChange={(next) => setExpanded(new Set(next))}
            onSelectionChange={(next) => setSelected(new Set(next))}
            rowHeight={22}
            indent={16}
            aria-label="数据源树"
          />
        </div>
      </section>

      {/* 下半：Services 面板 */}
      <section style={servicesPanelStyle}>
        <div style={headerStyle}>
          <span>Services</span>
          <div style={headerActionsStyle}>
            <IconButton
              icon="collapse-all"
              title="全部折叠"
              size="small"
              onClick={() => undefined}
            />
          </div>
        </div>
        <div style={treeBoxStyle}>
          <Tree<ServiceNode>
            roots={SERVICES_TREE}
            getKey={(node) => node.id}
            getLabel={(node) => node.label}
            getChildren={(node) => node.children}
            isExpandable={(node) => !!node.children && node.children.length > 0}
            renderNode={renderServiceNode}
            defaultExpanded={['service-query-execution', 'service-db-connection']}
            rowHeight={22}
            indent={16}
            aria-label="服务树"
          />
        </div>
      </section>
    </aside>
  )
}
