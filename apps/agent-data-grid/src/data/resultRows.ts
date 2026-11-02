/**
 * 结果区（ResultsPanel）的静态数据源。
 * 与 SPEC §10 的表格逐字一致：8 行查询结果。
 */

export type ResultStatus = 'Active' | 'Pending' | 'Inactive'

export interface ResultRow {
  index: number
  id: number
  full_name: string
  email: string
  plan: string
  status: ResultStatus
  created_at: string
}

export const RESULT_ROWS: ResultRow[] = [
  {
    index: 1,
    id: 10042,
    full_name: 'Liam Chen',
    email: 'liam.chen@acme.io',
    plan: 'Pro',
    status: 'Active',
    created_at: '2025-04-18 09:32:11',
  },
  {
    index: 2,
    id: 10041,
    full_name: 'Mia Rodriguez',
    email: 'mia.r@northstar.co',
    plan: 'Team',
    status: 'Active',
    created_at: '2025-04-18 09:28:04',
  },
  {
    index: 3,
    id: 10040,
    full_name: 'Noah Williams',
    email: 'noah.w@pixelbase.dev',
    plan: 'Free',
    status: 'Pending',
    created_at: '2025-04-18 09:14:52',
  },
  {
    index: 4,
    id: 10039,
    full_name: 'Emma Thompson',
    email: 'emma@arcstudio.design',
    plan: 'Pro',
    status: 'Active',
    created_at: '2025-04-18 08:57:36',
  },
  {
    index: 5,
    id: 10038,
    full_name: 'Oliver Smith',
    email: 'oliver@helios.ai',
    plan: 'Enterprise',
    status: 'Active',
    created_at: '2025-04-18 08:42:19',
  },
  {
    index: 6,
    id: 10037,
    full_name: 'Ava Martin',
    email: 'ava.martin@luma.app',
    plan: 'Team',
    status: 'Inactive',
    created_at: '2025-04-18 08:20:03',
  },
  {
    index: 7,
    id: 10036,
    full_name: 'Elijah Davis',
    email: 'elijah@vertexlabs.io',
    plan: 'Free',
    status: 'Active',
    created_at: '2025-04-18 08:01:47',
  },
  {
    index: 8,
    id: 10035,
    full_name: 'Sophia Wilson',
    email: 'sophia@papertrail.co',
    plan: 'Pro',
    status: 'Active',
    created_at: '2025-04-17 23:46:28',
  },
]
