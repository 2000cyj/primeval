/**
 * HTTP 错误码 → 中文提示映射（若依 兼容层）
 *
 * 业务文件直接 `import errorCode from '@remote/utils/errorCode'`。
 */
const errorCode: Record<string, string> = {
  '401': '认证失败，无法访问系统资源',
  '403': '当前操作没有权限',
  '404': '访问资源不存在',
  default: '系统未知错误，请反馈给管理员',
}

export default errorCode
