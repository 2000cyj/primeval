// @remote/utils 入口 barrel。
//
// 说明：is.ts 与 validate.ts 存在同名导出（isEmpty / isString / isArray），
// 二者靠子路径区分（@remote/utils/is、@remote/utils/validate），
// 所以这里对这两个模块用命名空间再导出，其余模块平铺导出。
export * as is from './is'
export * as validate from './validate'
export * from './scroll-to'
export * from './cron'
export * from './propTypes'
export * from './formatTime'
export * from './jsencrypt'
export { default as errorCode } from './errorCode'
