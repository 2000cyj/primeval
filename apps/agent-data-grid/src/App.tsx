import { useState } from 'react'

import { DatabaseExplorer } from './components/database/DatabaseExplorer'
import { ConsoleTabs } from './components/console/ConsoleTabs'
import { ConsoleToolbar } from './components/console/ConsoleToolbar'
import { ObjectInfoPanel } from './components/console/ObjectInfoPanel'
import { SqlConsole } from './components/console/SqlConsole'
import { ResultsPanel } from './components/results/ResultsPanel'
import { AppToolbar } from './components/shell/AppToolbar'
import { MenuBar } from './components/shell/MenuBar'
import { StatusBar } from './components/shell/StatusBar'
import { ToolWindowBar } from './components/shell/ToolWindowBar'
import './styles/layout.css'

const DEFAULT_SQL = `SELECT
    u.id,
    u.full_name,
    u.email,
    p.name AS plan,
    u.status,
    u.created_at
FROM users u
    LEFT JOIN plans p ON p.id = u.plan_id
WHERE u.created_at >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY u.created_at DESC
LIMIT 100;`

export function App() {
  const [activeTool, setActiveTool] = useState('database')
  const [activeConsoleTab, setActiveConsoleTab] = useState('query-1')
  const [sql, setSql] = useState(DEFAULT_SQL)
  const [autoCommit, setAutoCommit] = useState(true)
  const [limit, setLimit] = useState(100)

  return (
    <div className="adg-shell">
      <MenuBar />
      <AppToolbar dataSource="PostgreSQL - Acme Production @ localhost:5432" />

      <div className="adg-body">
        <ToolWindowBar active={activeTool} onActiveChange={setActiveTool} />
        <DatabaseExplorer />

        <main className="adg-workspace">
          <div className="adg-console">
            <div className="adg-console-main">
              <ConsoleTabs active={activeConsoleTab} onActiveChange={setActiveConsoleTab} />
              <ConsoleToolbar
                autoCommit={autoCommit}
                onAutoCommitChange={setAutoCommit}
                limit={limit}
                onLimitChange={setLimit}
              />
              <SqlConsole value={sql} onChange={setSql} />
            </div>
            <ObjectInfoPanel objectName="users" />
          </div>

          <section className="adg-results">
            <ResultsPanel />
          </section>
        </main>
      </div>

      <StatusBar
        connection="Acme Production @ localhost:5432"
        serverVersion="PostgreSQL 16.2"
        transaction="无事务"
      />
    </div>
  )
}
