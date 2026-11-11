/**
 * Skill 仓库的 Tauri command 封装。
 *
 * 四种添加方式（参照 multica 的实现）都落到 Rust 侧：
 * - 手动创建：写一份只有 frontmatter 的 SKILL.md；
 * - 本地导入：含 SKILL.md 的目录，或 .zip / .skill 压缩包；
 * - URL 导入：拉取已发布的 skill；
 * - 运行时复制：把本机运行时里已装好的 skill 提升到工作区。
 *
 * command 名一律取自 SKILL_COMMANDS，不在此处硬编码字符串。
 */
import { invoke } from '@tauri-apps/api/core'

/** skill 的来源 */
export type SkillSource = 'manual' | 'url' | 'local' | 'runtime' | 'duplicate'

/** 工作区里的一个 skill */
export interface SkillInfo {
  name: string
  description: string
  /** skill 目录的绝对路径 */
  path: string
  /**
   * 相对 `~/.agent-compose` 的路径（如 `skills/knowledge-base`）。
   *
   * 智能体绑定 skill 时存这个引用，而不是名字 —— 在 Skills 页改了 skill 的
   * 名字或描述，智能体那边不用跟着改。
   */
  relativePath: string
  /** 来源：manual / url / local / runtime */
  source: SkillSource
  /** 是否启用 */
  enabled: boolean
  /** 是否有可重新拉取的来源（可用于「从来源更新」） */
  refreshable: boolean
  /** 最后修改时间（epoch 毫秒） */
  updatedAtMs: number
  /** 目录内的文件数（含 SKILL.md） */
  fileCount: number
}

/** 运行时里已装好、可以提升到工作区的 skill */
export interface RuntimeSkillInfo {
  name: string
  description: string
  /** 运行时里的绝对路径 */
  path: string
  /** 运行时名称，如「Claude Code」 */
  runtime: string
  /** 工作区里是否已经有同名 skill */
  installed: boolean
}

/** skill 目录里的一个文件 */
export interface SkillFileInfo {
  /** 相对路径（`/` 分隔） */
  rel: string
  /** 文件大小（字节） */
  size: number
}

/** 一个 skill 的完整信息（详情抽屉 / 编辑器用） */
export interface SkillDetail {
  name: string
  description: string
  /** skill 目录的绝对路径 */
  path: string
  source: SkillSource
  enabled: boolean
  /** SKILL.md 正文（不含 frontmatter） */
  content: string
  /** frontmatter 里的其它字段 */
  frontmatter: Record<string, string>
  /** 目录下的文件清单 */
  files: SkillFileInfo[]
  /** 目录总大小（字节） */
  totalSize: number
  /** 最后修改时间（epoch 毫秒） */
  updatedAtMs: number
}

export const SKILL_COMMANDS = {
  list: 'skills_list',
  createManual: 'skills_create_manual',
  importUrl: 'skills_import_url',
  importLocal: 'skills_import_local',
  listRuntime: 'skills_list_runtime',
  importRuntime: 'skills_import_runtime',
  remove: 'skills_remove',
  setEnabled: 'skills_set_enabled',
  refresh: 'skills_refresh',
  read: 'skills_read',
  update: 'skills_update',
  duplicate: 'skills_duplicate',
  pickSource: 'skills_pick_source',
} as const

/** 统一的错误包装：保留原始原因，便于界面直接展示 */
function fail(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${action}失败：${detail}`, { cause: error })
}

/** 列出工作区里的 skill */
export async function listSkills(): Promise<SkillInfo[]> {
  try {
    return await invoke<SkillInfo[]>(SKILL_COMMANDS.list)
  } catch (error) {
    throw fail('读取 skill 列表', error)
  }
}

/** 手动创建 skill */
export async function createManualSkill(name: string, description: string): Promise<SkillInfo> {
  try {
    return await invoke<SkillInfo>(SKILL_COMMANDS.createManual, { name, description })
  } catch (error) {
    throw fail('创建 skill', error)
  }
}

/** 从 URL 导入 skill */
export async function importSkillFromUrl(url: string): Promise<SkillInfo> {
  try {
    return await invoke<SkillInfo>(SKILL_COMMANDS.importUrl, { url })
  } catch (error) {
    throw fail('从 URL 导入 skill', error)
  }
}

/** 从本地目录或压缩包导入 skill */
export async function importSkillFromLocal(path: string): Promise<SkillInfo> {
  try {
    return await invoke<SkillInfo>(SKILL_COMMANDS.importLocal, { path })
  } catch (error) {
    throw fail('从本地导入 skill', error)
  }
}

/** 列出本机运行时里已装好的 skill */
export async function listRuntimeSkills(): Promise<RuntimeSkillInfo[]> {
  try {
    return await invoke<RuntimeSkillInfo[]>(SKILL_COMMANDS.listRuntime)
  } catch (error) {
    throw fail('读取运行时 skill', error)
  }
}

/** 把运行时里的 skill 复制到工作区 */
export async function importRuntimeSkill(path: string): Promise<SkillInfo> {
  try {
    return await invoke<SkillInfo>(SKILL_COMMANDS.importRuntime, { path })
  } catch (error) {
    throw fail('从运行时复制 skill', error)
  }
}

/** 删除工作区里的 skill */
export async function removeSkill(name: string): Promise<void> {
  try {
    await invoke(SKILL_COMMANDS.remove, { name })
  } catch (error) {
    throw fail('删除 skill', error)
  }
}

/** 启用 / 停用一个 skill */
export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  try {
    await invoke(SKILL_COMMANDS.setEnabled, { name, enabled })
  } catch (error) {
    throw fail('更新 skill 状态', error)
  }
}

/** 从来源更新一个 skill（重新拉取来源内容并覆盖本地副本） */
export async function refreshSkill(name: string): Promise<SkillInfo> {
  try {
    return await invoke<SkillInfo>(SKILL_COMMANDS.refresh, { name })
  } catch (error) {
    throw fail('从来源更新 skill', error)
  }
}

/** 读一个 skill 的完整信息 */
export async function readSkill(name: string): Promise<SkillDetail> {
  try {
    return await invoke<SkillDetail>(SKILL_COMMANDS.read, { name })
  } catch (error) {
    throw fail('读取 skill', error)
  }
}

/** 修改 skill：改名 / 改描述 / 改正文 */
export async function updateSkill(params: {
  name: string
  newName?: string
  description?: string
  content?: string
}): Promise<SkillInfo> {
  try {
    return await invoke<SkillInfo>(SKILL_COMMANDS.update, {
      name: params.name,
      newName: params.newName ?? null,
      description: params.description ?? null,
      content: params.content ?? null,
    })
  } catch (error) {
    throw fail('保存 skill', error)
  }
}

/** 创建副本 */
export async function duplicateSkill(name: string, newName: string): Promise<SkillInfo> {
  try {
    return await invoke<SkillInfo>(SKILL_COMMANDS.duplicate, { name, newName })
  } catch (error) {
    throw fail('创建副本', error)
  }
}

/**
 * 弹出系统选择框。
 *
 * kind：folder 选目录，archive 选压缩包。取消选择返回 null。
 */
export async function pickSource(kind: 'folder' | 'archive'): Promise<string | null> {
  try {
    return await invoke<string | null>(SKILL_COMMANDS.pickSource, { kind })
  } catch (error) {
    throw fail('打开系统选择框', error)
  }
}
