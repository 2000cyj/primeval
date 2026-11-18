/**
 * 数据版本号。
 *
 * # 为什么需要
 *
 * 页面被 `<KeepAlive>` 缓存着 —— 切走再切回来**不会重新挂载**，
 * 于是也不会重新加载数据。别的页面改了数据，这边就看不到。
 *
 * 改数据的地方把对应的版本号 +1，页面在**激活时**比对：
 * 版本变了才重新加载。
 *
 * # 为什么不用「每次激活都重载」
 *
 * 那会让缓存失去意义 —— 切回来照样要等一次加载，列表还会闪一下。
 * 用户要的正是「切回来是瞬时的，滚动位置和筛选条件都还在」。
 *
 * （滚动位置和筛选条件由 KeepAlive 保留；数据是另一回事 ——
 *  数据变了就该更新，但只在真的变了的时候。）
 */
import { ref } from 'vue'

/** Skill 数据的版本。 */
const skills = ref(0)
/** MCP server 数据的版本。 */
const mcp = ref(0)
/** Wiki 页面数据的版本。 */
const wiki = ref(0)

/** Skill 数据变了（新建 / 改名 / 删除 / 从 Wiki 发布成 Skill）。 */
export const bumpSkills = (): void => {
  skills.value += 1
}

/** MCP server 数据变了（只有导入备份会从别的页面改到它）。 */
export const bumpMcp = (): void => {
  mcp.value += 1
}

/** Wiki 页面数据变了（只有导入备份会从别的页面改到它）。 */
export const bumpWiki = (): void => {
  wiki.value += 1
}

/** 当前 Skill 数据版本。 */
export const skillsRevision = skills
/** 当前 MCP server 数据版本。 */
export const mcpRevision = mcp
/** 当前 Wiki 数据版本。 */
export const wikiRevision = wiki
