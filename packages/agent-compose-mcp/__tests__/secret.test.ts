import { describe, expect, it } from 'vitest'
import { resolveSecret, resolveSecretRecord, secretEnvName } from '../src/secret.ts'

describe('密钥解析：字面量', () => {
  it('没有占位符就原样返回', () => {
    const result = resolveSecret('Bearer g_abc123', {})
    expect(result.value).toBe('Bearer g_abc123')
    expect(result.source).toBe('literal')
    expect(result.error).toBeUndefined()
  })

  it('空值也算字面量', () => {
    const result = resolveSecret('', {})
    expect(result.value).toBe('')
    expect(result.source).toBe('literal')
  })
})

describe('密钥解析：环境变量', () => {
  it('占位符换成环境变量的值', () => {
    const result = resolveSecret('Bearer ${ENV:TOKEN}', { TOKEN: 'real-value' })
    expect(result.value).toBe('Bearer real-value')
    expect(result.source).toBe('env')
    expect(result.envName).toBe('TOKEN')
  })

  it('纯占位符也能解析', () => {
    const result = resolveSecret('${ENV:TOKEN}', { TOKEN: 'real-value' })
    expect(result.value).toBe('real-value')
  })

  it('多个占位符都能替换', () => {
    const result = resolveSecret('${ENV:A}-${ENV:B}', { A: '1', B: '2' })
    expect(result.value).toBe('1-2')
  })

  it('环境变量没设时报错，不返回占位符本身', () => {
    const result = resolveSecret('Bearer ${ENV:MISSING}', {})
    expect(result.error).toContain('MISSING')
    expect(result.value).toBe('')
    // 关键：绝不能把 ${ENV:MISSING} 原样发出去
    expect(result.value).not.toContain('${ENV:')
  })

  it('环境变量是空串也算没设', () => {
    const result = resolveSecret('Bearer ${ENV:EMPTY}', { EMPTY: '' })
    expect(result.error).toContain('EMPTY')
  })

  it('报出所有缺失的变量名', () => {
    const result = resolveSecret('${ENV:A}-${ENV:B}', { A: 'x' })
    expect(result.error).toContain('B')
    expect(result.error).not.toContain('A、')
  })
})

describe('密钥解析：整张表', () => {
  it('全部解析成功时给出值', () => {
    const { values, errors } = resolveSecretRecord(
      { Authorization: 'Bearer ${ENV:TOKEN}', 'X-Key': 'plain' },
      { TOKEN: 'real' },
    )
    expect(errors).toEqual([])
    expect(values).toEqual({ Authorization: 'Bearer real', 'X-Key': 'plain' })
  })

  it('有一个解析不出来就整张表失败', () => {
    const { values, errors } = resolveSecretRecord(
      { Authorization: 'Bearer ${ENV:MISSING}', 'X-Key': 'plain' },
      {},
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('MISSING')
    expect(errors[0]).toContain('Authorization')
    // 半张表能用比全不能用更难排查 —— 整张表都别给
    expect(values.Authorization).toBeUndefined()
  })

  it('空表没问题', () => {
    const { values, errors } = resolveSecretRecord(undefined, {})
    expect(values).toEqual({})
    expect(errors).toEqual([])
  })
})

describe('令牌来源识别', () => {
  it('字面量没有环境变量名', () => {
    expect(secretEnvName('Bearer g_abc')).toBeUndefined()
  })

  it('能认出环境变量名', () => {
    expect(secretEnvName('Bearer ${ENV:FIGMA_TOKEN}')).toBe('FIGMA_TOKEN')
  })

  it('空值没有环境变量名', () => {
    expect(secretEnvName(undefined)).toBeUndefined()
    expect(secretEnvName('')).toBeUndefined()
  })
})
