/**
 * 类型判断工具（yudao 兼容层）
 *
 * 业务文件直接 `import { isEmpty, isEmptyVal } from '@remote/utils/is'`。
 */

/** 是否为字符串 */
export function isString(val: unknown): val is string {
  return typeof val === 'string'
}

/** 是否为数字 */
export function isNumber(val: unknown): val is number {
  return typeof val === 'number' && !Number.isNaN(val)
}

/** 是否为布尔 */
export function isBoolean(val: unknown): val is boolean {
  return typeof val === 'boolean'
}

/** 是否为函数 */
export function isFunction(val: unknown): val is (...args: any[]) => any {
  return typeof val === 'function'
}

/** 是否为对象（含数组） */
export function isObject(val: unknown): val is Record<string, any> {
  return val !== null && typeof val === 'object'
}

/** 是否为数组 */
export function isArray(val: unknown): val is any[] {
  return Array.isArray(val)
}

/** 是否为 undefined / null */
export function isNullOrUndef(val: unknown): val is null | undefined {
  return val === undefined || val === null
}

/**
 * 是否为空：undefined / null / '' / [] / {} 均视为空
 */
export function isEmpty(val: unknown): boolean {
  if (val === undefined || val === null) return true
  if (typeof val === 'string') return val.length === 0
  if (Array.isArray(val)) return val.length === 0
  if (val instanceof Map || val instanceof Set) return val.size === 0
  if (typeof val === 'object') return Object.keys(val as object).length === 0
  return false
}

/**
 * 是否为"空值"：与 isEmpty 一致，且 0 / false 不视为空
 * （部分业务 form 校验中 0 / false 应该被视为有效值）
 */
export function isEmptyVal(val: unknown): boolean {
  return isEmpty(val)
}

/** Promise 判断 */
export function isPromise<T = any>(val: unknown): val is Promise<T> {
  return isObject(val) && isFunction((val as any).then) && isFunction((val as any).catch)
}

/** 是否为 URL 字符串 */
export function isUrl(val: string): boolean {
  return /^(https?:|mailto:|tel:)/.test(val)
}
