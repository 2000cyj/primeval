/**
 * 左栏（Database Explorer）的静态数据源树与服务树。
 *
 * - 树结构对齐 DataGrip 的「数据库」工具窗口：数据源 → 库 → Schemas/Tables/Views/
 *   Functions/Roles/Extensions。
 * - `icon` 字段存放 UI 套件 `ui/icons.tsx` 中真实存在的 expui 图标名。
 */

export interface DbTreeNode {
  id: string
  label: string
  icon: string
  kind: 'source' | 'database' | 'folder' | 'table' | 'view' | 'function' | 'role' | 'extension'
  /** 行尾右侧计数，如 Schemas 3 / Tables 12。 */
  detail?: string
  children?: DbTreeNode[]
}

export interface ServiceNode {
  id: string
  label: string
  /** 叶子节点状态：ok（运行中）/ idle（空闲）。 */
  status?: 'ok' | 'idle'
  children?: ServiceNode[]
}

export const DATA_SOURCE_TREE: DbTreeNode[] = [
  {
    id: 'acme-production',
    label: 'Acme Production',
    icon: 'database',
    kind: 'source',
    children: [
      {
        id: 'acme-customer-analytics',
        label: 'customer_analytics',
        icon: 'db-postgres',
        kind: 'database',
        children: [
          {
            id: 'acme-customer-analytics-schemas',
            label: 'Schemas',
            icon: 'db-folder',
            kind: 'folder',
            detail: '3',
            children: [
              {
                id: 'acme-customer-analytics-public',
                label: 'public',
                icon: 'db-schema',
                kind: 'folder',
                children: [
                  {
                    id: 'acme-customer-analytics-public-tables',
                    label: 'Tables',
                    icon: 'db-folder',
                    kind: 'folder',
                    detail: '12',
                    children: [
                      {
                        id: 'users',
                        label: 'users',
                        icon: 'db-table',
                        kind: 'table',
                      },
                      {
                        id: 'accounts',
                        label: 'accounts',
                        icon: 'db-table',
                        kind: 'table',
                      },
                      {
                        id: 'events',
                        label: 'events',
                        icon: 'db-table',
                        kind: 'table',
                      },
                      {
                        id: 'invoices',
                        label: 'invoices',
                        icon: 'db-table',
                        kind: 'table',
                      },
                      {
                        id: 'plans',
                        label: 'plans',
                        icon: 'db-table',
                        kind: 'table',
                      },
                    ],
                  },
                  {
                    id: 'acme-customer-analytics-public-views',
                    label: 'Views',
                    icon: 'db-folder',
                    kind: 'folder',
                    detail: '4',
                    children: [
                      {
                        id: 'v_user_summary',
                        label: 'v_user_summary',
                        icon: 'db-view',
                        kind: 'view',
                      },
                      {
                        id: 'v_monthly_revenue',
                        label: 'v_monthly_revenue',
                        icon: 'db-view',
                        kind: 'view',
                      },
                      {
                        id: 'v_active_users',
                        label: 'v_active_users',
                        icon: 'db-view',
                        kind: 'view',
                      },
                    ],
                  },
                  {
                    id: 'acme-customer-analytics-public-functions',
                    label: 'Functions',
                    icon: 'db-folder',
                    kind: 'folder',
                    detail: '7',
                    children: [
                      {
                        id: 'fn_refresh_totals',
                        label: 'fn_refresh_totals',
                        icon: 'db-routine',
                        kind: 'function',
                      },
                      {
                        id: 'fn_audit_log',
                        label: 'fn_audit_log',
                        icon: 'db-routine',
                        kind: 'function',
                      },
                    ],
                  },
                ],
              },
              {
                id: 'acme-customer-analytics-staging',
                label: 'staging',
                icon: 'db-schema',
                kind: 'folder',
              },
              {
                id: 'acme-customer-analytics-archive',
                label: 'archive',
                icon: 'db-schema',
                kind: 'folder',
              },
            ],
          },
          {
            id: 'acme-customer-analytics-roles',
            label: 'Roles',
            icon: 'db-folder',
            kind: 'folder',
            children: [
              {
                id: 'role-app-reader',
                label: 'app_reader',
                icon: 'db-key',
                kind: 'role',
              },
              {
                id: 'role-analytics-writer',
                label: 'analytics_writer',
                icon: 'db-key',
                kind: 'role',
              },
            ],
          },
          {
            id: 'acme-customer-analytics-extensions',
            label: 'Extensions',
            icon: 'db-folder',
            kind: 'folder',
            children: [
              {
                id: 'ext-pgcrypto',
                label: 'pgcrypto',
                icon: 'db-properties',
                kind: 'extension',
              },
            ],
          },
        ],
      },
      {
        id: 'acme-sales-warehouse',
        label: 'sales_warehouse',
        icon: 'db-postgres',
        kind: 'database',
        children: [
          {
            id: 'acme-sales-warehouse-schemas',
            label: 'Schemas',
            icon: 'db-folder',
            kind: 'folder',
            detail: '2',
            children: [
              {
                id: 'acme-sales-warehouse-public',
                label: 'public',
                icon: 'db-schema',
                kind: 'folder',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'staging-warehouse',
    label: 'Staging Warehouse',
    icon: 'database',
    kind: 'source',
    children: [
      {
        id: 'staging-warehouse-events',
        label: 'event_stream',
        icon: 'db-postgres',
        kind: 'database',
        children: [
          {
            id: 'staging-warehouse-events-schemas',
            label: 'Schemas',
            icon: 'db-folder',
            kind: 'folder',
            detail: '1',
            children: [
              {
                id: 'staging-warehouse-events-public',
                label: 'public',
                icon: 'db-schema',
                kind: 'folder',
                children: [
                  {
                    id: 'staging-warehouse-events-public-tables',
                    label: 'Tables',
                    icon: 'db-folder',
                    kind: 'folder',
                    detail: '5',
                    children: [
                      {
                        id: 'staging_events',
                        label: 'events_staging',
                        icon: 'db-table',
                        kind: 'table',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'local-sandbox',
    label: 'Local Sandbox',
    icon: 'database',
    kind: 'source',
    children: [
      {
        id: 'local-sandbox-dev',
        label: 'dev_db',
        icon: 'db-postgres',
        kind: 'database',
      },
    ],
  },
]

export const SERVICES_TREE: ServiceNode[] = [
  {
    id: 'service-query-execution',
    label: '查询执行',
    children: [
      {
        id: 'service-run-customer-growth',
        label: "Run 'customer_growth.sql'",
        status: 'ok',
      },
    ],
  },
  {
    id: 'service-db-connection',
    label: '数据库连接',
    children: [
      {
        id: 'service-acme-production',
        label: 'Acme Production',
        status: 'idle',
      },
    ],
  },
]
