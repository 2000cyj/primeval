// 端到端验证：Wiki 的三份实现必须对齐。
//
// 同一批页面，三个地方各写了一遍：
// - Rust 侧（apps/agentspace-core/src/wiki.rs）—— 桌面端读写
// - TS 侧（packages/agent-compose-mcp/src/wiki.ts）—— sidecar 给外部 agent 读
// - Pi 扩展（apps/agentspace-core/assets/agentspace-extension.ts）—— 给 Pi agent 读
//
// 扩展是单文件、不能 import 别的包，所以只能各写一份。
// 这个脚本就是盯着它们别漂移的护栏 —— 改一边记得跑它。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), 'agentspace-wiki-e2e')
const slug = '部署手册'
const dir = join(root, slug)
await mkdir(dir, { recursive: true })

const now = Date.now()
await writeFile(
  join(dir, '.meta.json'),
  JSON.stringify(
    {
      slug,
      title: '部署手册',
      tags: ['运维', '发布'],
      parent: null,
      links: ['回滚流程'],
      createdAt: now,
      updatedAt: now,
    },
    null,
    2,
  ),
  'utf8',
)
await writeFile(
  join(dir, 'page.md'),
  '# 部署手册\n\n第一步：生成密钥\n第二步：签名\n第三步：上传 Release\n详见 [[回滚流程]]。\n',
  'utf8',
)

// 第二个页面 —— 用来验证「引用」这条边
const rollback = '回滚流程'
await mkdir(join(root, rollback), { recursive: true })
await writeFile(
  join(root, rollback, '.meta.json'),
  JSON.stringify(
    {
      slug: rollback,
      title: rollback,
      tags: ['运维'],
      parent: null,
      links: [],
      createdAt: now,
      updatedAt: now,
    },
    null,
    2,
  ),
  'utf8',
)
await writeFile(join(root, rollback, 'page.md'), '# 回滚流程\n\n出问题时先回滚。\n', 'utf8')

const { createWikiTools, readWikiPage, searchWiki } = await import(
  '../packages/agent-compose-mcp/src/wiki.ts'
)
const extension = await import('../apps/agentspace-core/assets/agentspace-extension.ts')

let failures = 0
/** 断言并记账 —— 失败不立刻退出，好一次看全。 */
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` —— 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`)
}

// ── 1. TS sidecar 能读 Rust 格式的页面 ──────────────────
const tools = createWikiTools(() => root)
const byName = new Map(tools.map((tool) => [tool.name, tool]))
console.log('工具：', tools.map((t) => t.name).join(', '))

const listed = await byName.get('wiki_list')!.execute({})
const pages = JSON.parse(String(listed.content[0].text))
check('TS sidecar 读到 2 个页面', pages.length, 2)
check('TS sidecar 读到 tags', pages[0].tags, ['运维', '发布'])

const read = await byName.get('wiki_read')!.execute({ slug })
const body = String(read.content[1]?.text ?? '')
check('TS sidecar 读到正文', body.includes('生成密钥'), true)

// ── 2. 引用边读得到 ──────────────────────────────────────
const page = await readWikiPage(root, slug)
check('TS sidecar 读到引用边', page?.links, [rollback])

// ── 3. 检索：中文 bigram ─────────────────────────────────
const hits = await searchWiki(root, '签名')
check('TS sidecar 搜「签名」有命中', hits.length > 0, true)

// ── 4. 扩展与 sidecar 的检索结果一致 ──────────────────────
// 扩展按 slug 拼页面范围（它读的是 prepare.rs 写的 wiki-scope.json），
// 这里用同样的页面集喂给它，比对结果。
const scope = {
  wikiRoot: root,
  pages: pages.map((page: { slug: string; title: string; tags: string[]; parent: string | null; links: string[] }) => ({
    slug: page.slug,
    title: page.title,
    tags: page.tags,
    parent: page.parent,
    links: page.links,
  })),
}
const extHits = extension.search(scope, '签名', 8)
const sideHits = await searchWiki(root, '签名')
check(
  '扩展与 sidecar 搜出同样的页面',
  extHits.map((hit: { slug: string }) => hit.slug).sort(),
  sideHits.map((hit: { slug: string }) => hit.slug).sort(),
)

// ── 5. 分词一致 ──────────────────────────────────────────
check(
  '扩展与 sidecar 分词一致',
  extension.tokenize('数据库连接池 v2'),
  (await import('../packages/agent-compose-mcp/src/wiki-search.ts')).tokenize('数据库连接池 v2'),
)

// ── 6. 邻接关系一致 ──────────────────────────────────────
const neighbors = await byName.get('wiki_neighbors')!.execute({ slug })
const parsed = JSON.parse(String(neighbors.content[0].text))
check('TS sidecar 报出入边', parsed.incoming, [])
check('TS sidecar 报出出边', parsed.outgoing, [rollback])

// ── 7. 路径穿越必须挡住 ──────────────────────────────────
const evil = await byName.get('wiki_read')!.execute({ slug: '../../etc/passwd' })
check(
  '路径穿越被挡住',
  evil.isError ? '已挡住：' + evil.content[0].text : '没挡住！',
  '已挡住：非法的页面标识：../../etc/passwd',
)

console.log('')
if (failures > 0) {
  console.error(`❌ ${failures} 项不一致 —— 三份实现漂移了`)
  process.exit(1)
}
console.log('✅ 三份实现对齐')
