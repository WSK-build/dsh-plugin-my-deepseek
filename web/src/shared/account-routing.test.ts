import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { shouldRouteToAccount } from './account-routing.ts'

/**
 * 请求归属判定的规则。
 *
 * 判定函数接受“账号桥是否可用”作为入参，因此可以在没有原生壳的 Node 环境里
 * 固定住“何时由账号模式接管请求”这条规则。
 */
describe('shouldRouteToAccount', () => {
  it('空串 x-api-key 视为未提供凭据，交给账号模式', () => {
    // 上游客户端在 API Key 为空时仍会写入该头，这正是账号模式的主路径。
    assert.equal(shouldRouteToAccount(true, { 'x-api-key': '' }), true)
  })

  it('空白字符同样视为未提供凭据', () => {
    assert.equal(shouldRouteToAccount(true, { 'x-api-key': '   ' }), true)
  })

  it('真实 API Key 不接管', () => {
    assert.equal(shouldRouteToAccount(true, { 'x-api-key': 'sk-test-key' }), false)
  })

  it('Authorization 不接管，校验的是用户填写的凭据', () => {
    assert.equal(shouldRouteToAccount(true, { Authorization: 'Bearer sk-test-key' }), false)
  })

  it('无凭据头时交给账号模式', () => {
    assert.equal(shouldRouteToAccount(true, undefined), true)
    assert.equal(shouldRouteToAccount(true, {}), true)
    assert.equal(shouldRouteToAccount(true, { 'content-type': 'application/json' }), true)
  })

  it('头名大小写不敏感', () => {
    assert.equal(shouldRouteToAccount(true, { 'X-Api-Key': 'sk-test-key' }), false)
    assert.equal(shouldRouteToAccount(true, { AUTHORIZATION: 'Bearer sk-test-key' }), false)
  })

  it('账号桥不可用时不接管', () => {
    assert.equal(shouldRouteToAccount(false, { 'x-api-key': '' }), false)
    assert.equal(shouldRouteToAccount(false, undefined), false)
  })
})
