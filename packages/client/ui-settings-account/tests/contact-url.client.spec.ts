import { expect, it } from 'vitest'
import type { AccountUserId } from '@deepseek-ai/dsh-deepseek-account/types'
import { Config } from '../src/contact-config.ts'
import { contactUrl } from '../src/client/contact-url.ts'

it('prefills available support context and hides all context fields', () => {
  const config = Config({ contactSource: 'app_harness' })
  const url = new URL(contactUrl(config, {
    uid: 'user&123' as AccountUserId, version: '1.2.3', locale: 'zh-CN',
    width: 1512, height: 982, pixelRatio: 2,
  }))
  expect(url.origin).toBe('https://trtgsjkv6r.feishu.cn')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    hide_uid: '1', prefill_uid: 'user&123', hide_source: '1', prefill_source: 'app_harness',
    hide_app_version: '1', prefill_app_version: '1.2.3', hide_os_version: '1',
    hide_device_brand: '1', hide_device_model: '1', hide_app_locale: '1', prefill_app_locale: 'zh-CN',
    hide_screen_resolution: '1', prefill_screen_resolution: '3024x1964',
  })
})

it('opens a configured form without stale account context when signed out', () => {
  const url = new URL(contactUrl(Config({ contactFormUrl: 'https://example.test/form/?prefill_uid=old&prefill_source=old' }), {
    uid: null, version: undefined, locale: 'en', width: 0, height: 0, pixelRatio: 1,
  }))
  expect(url.origin).toBe('https://example.test')
  expect(url.searchParams.has('prefill_uid')).toBe(false)
  expect(url.searchParams.has('prefill_source')).toBe(false)
  expect(url.searchParams.has('prefill_screen_resolution')).toBe(false)
  expect(url.searchParams.get('hide_uid')).toBe('1')
  expect(() => Config({ contactFormUrl: 'javascript:alert(1)' })).toThrow()
})

it.each([NaN, Infinity])('uses CSS pixel dimensions when device pixel ratio is %s', (pixelRatio) => {
  const url = new URL(contactUrl(Config({}), {
    uid: null, version: undefined, locale: 'en', width: 800, height: 600, pixelRatio,
  }))
  expect(url.searchParams.get('prefill_screen_resolution')).toBe('800x600')
})
