// 端到端验证：Rust 侧写的 wiki 页面，sidecar 的工具能不能读出来。
//
// 两个实现各写各的（Rust 写页面 / TS 读页面），布局必须一致 ——
// 这个脚本造一个 Rust 格式的页面，再用 sidecar 的工具读它。
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
  '# 部署手册\n\n第一步：生成密钥\n第二步：签名\n第三步：上传 Release\n',
  'utf8',
)

const { createWikiTools } = await import('../packages/agent-compose-mcp/src/wiki.ts')

const tools = createWikiTools(() => root)
const byName = new Map(tools.map((tool) => [tool.name, tool]))

console.log('工具：', tools.map((t) => t.name).join(', '))

const listed = await byName.get('wiki_list')!.execute({})
const pages = JSON.parse(String(listed.content[0].text))
console.log('wiki_list →', pages.length, '页')
console.log('  第一页：', pages[0].title, '| tags:', pages[0].tags.join(','), '| parent:', pages[0].parent)

const read = await byName.get('wiki_read')!.execute({ slug })
// 正文是第二个 content item（第一个是页面信息）
const meta = JSON.parse(String(read.content[0].text).replace('页面信息：', ''))
const body = String(read.content[1]?.text ?? '')
console.log('wiki_read →', meta.title)
console.log('  正文首行：', body.split('\n')[0])
console.log('  正文含「生成密钥」：', body.includes('生成密钥'))
console.log('  正文行数：', body.split('\n').length)

const searched = await byName.get('wiki_search')!.execute({ query: '签名' })
const hits = JSON.parse(String(searched.content[0].text))
console.log('wiki_search("签名") →', hits.length, '条命中')
for (const hit of hits) console.log('  ', hit.title, '| line', hit.line, '|', hit.snippet)

// 路径穿越必须挡住
const evil = await byName.get('wiki_read')!.execute({ slug: '../../etc/passwd' })
console.log('路径穿越 →', evil.isError ? '已挡住：' + evil.content[0].text : '❌ 没挡住！')
