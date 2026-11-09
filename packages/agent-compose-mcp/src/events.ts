/**
 * sidecar 内部事件总线：上游状态变化、调用日志、配置变更。
 *
 * 极简实现：on / off / emit，不做通配符、不做异步派发。
 * 调用日志额外保留在内存环形缓冲里（最近 500 条），供 UI 拉取。
 */
import type { McpCallLog, McpUpstreamStatus } from './types.ts'

/** 配置变更的种类 */
export type McpConfigChangeKind = 'servers' | 'exposure' | 'profiles'

/** 配置变更事件负载 */
export type McpConfigChange = {
  kind: McpConfigChangeKind
}

/** 事件类型 → 负载类型 */
export type McpEventMap = {
  'upstream-status': McpUpstreamStatus
  'call-log': McpCallLog
  'config-changed': McpConfigChange
}

/** 全部事件类型 */
export type McpEventType = keyof McpEventMap

/** 事件负载映射表（按事件类型索引） */
type HandlerMap = {
  [K in McpEventType]: Set<(payload: McpEventMap[K]) => void>
}

/** 调用日志环形缓冲容量 */
export const CALL_LOG_CAPACITY = 500

export class EventBus {
  private readonly handlers: HandlerMap = {
    'upstream-status': new Set(),
    'call-log': new Set(),
    'config-changed': new Set(),
  }

  /** 调用日志环形缓冲（先进先出，超出容量丢最旧的） */
  private readonly callLogs: McpCallLog[] = []

  /**
   * 订阅事件，返回取消订阅的函数。
   */
  on<T extends McpEventType>(type: T, handler: (payload: McpEventMap[T]) => void): () => void {
    const bucket = this.handlers[type]
    bucket.add(handler)
    return () => {
      bucket.delete(handler)
    }
  }

  /**
   * 取消订阅。
   */
  off<T extends McpEventType>(type: T, handler: (payload: McpEventMap[T]) => void): void {
    this.handlers[type].delete(handler)
  }

  /**
   * 广播事件。单个 handler 抛错不影响其它 handler。
   */
  emit<T extends McpEventType>(type: T, payload: McpEventMap[T]): void {
    for (const handler of this.handlers[type]) {
      try {
        handler(payload)
      } catch {
        // 订阅方自身的异常不能打断广播
      }
    }
  }

  /**
   * 记录一次工具调用：写入环形缓冲并广播 `call-log` 事件。
   * 调用日志必须走这个入口，否则不会进入缓冲。
   */
  recordCallLog(log: McpCallLog): void {
    this.callLogs.push(log)
    while (this.callLogs.length > CALL_LOG_CAPACITY) {
      this.callLogs.shift()
    }
    this.emit('call-log', log)
  }

  /**
   * 取调用日志（按时间正序：最旧 → 最新）。
   */
  getCallLogs(): McpCallLog[] {
    return [...this.callLogs]
  }

  /**
   * 清空调用日志。
   */
  clearCallLogs(): void {
    this.callLogs.length = 0
  }
}
