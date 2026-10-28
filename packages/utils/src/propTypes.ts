/**
 * propTypes（yudao 兼容层）
 *
 * 业务代码用 `propTypes.string.def('')`、`propTypes.object.def({})`、`propTypes.bool.def(false)` 等。
 * 返回符合 Vue 3 Prop 定义的对象 `{ type, default }`。
 *
 * 注：vue-tsc 在 bundler resolution + 严格模式下偶发把 `import { PropType }` 当成不存在的导出，
 * 这里把 PropType 当成 `any` 处理（运行时无类型校验只看 type 字段），不影响实际行为。
 */
export type PropType<T> = any & { __t?: T }

class PropType_<T> {
  type: any
  default?: T

  constructor(type: any) {
    this.type = type
  }

  /** 设置默认值（普通值） */
  def(value: T): { type: any; default: T } {
    return { type: this.type, default: value }
  }

  /** 设置默认值（函数返回） */
  defFn(fn: () => T): { type: any; default: () => T } {
    return { type: this.type, default: fn }
  }

  /** 标记必填（yudao 风格 propTypes.string.isRequired） */
  get isRequired(): { type: any; required: true } {
    return { type: this.type, required: true }
  }
}

export const propTypes = {
  string: new PropType_<string>(String),
  number: new PropType_<number>(Number),
  bool: new PropType_<boolean>(Boolean),
  object: new PropType_<Record<string, any>>(Object),
  array: new PropType_<any[]>(Array),
  func: new PropType_<(...args: any[]) => any>(Function),
  /** any 类型（无校验） */
  any: new PropType_<any>(null),
}

/** 直接生成 PropType 对象的辅助函数（用于复杂泛型场景） */
export const objectOf = <T>() => Object as unknown as PropType<T>
