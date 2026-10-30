import { describe, expect, it } from 'vitest'
import { NetworkError, RequestError, type OpenResult } from '@/api'
import { failureError, nextStep, type Step } from '@/views/reveal-flow'

const ok: OpenResult = { status: 'ok', ciphertext: 'c', iv: 'i' }

describe('nextStep', () => {
  const cases: [string, OpenResult, boolean, Step][] = [
    ['opened without password', ok, false, { next: 'revealed', wipe: true }],
    ['opened with password', ok, true, { next: 'revealed', wipe: true }],
    ['gone without password', { status: 'gone' }, false, { next: 'gone', wipe: true }],
    ['gone with password', { status: 'gone' }, true, { next: 'gone', wipe: true }],
    [
      'wrong key, no password',
      { status: 'wrong', remaining: 3 },
      false,
      { next: 'damaged', wipe: true },
    ],
    [
      'wrong password, attempts exhausted',
      { status: 'wrong', remaining: 0 },
      true,
      { next: 'destroyed', wipe: true },
    ],
    [
      'wrong password, one attempt left',
      { status: 'wrong', remaining: 1 },
      true,
      { next: 'ready', wipe: false, error: { key: 'wrongPasswordOne', params: { n: 1 } } },
    ],
    [
      'wrong password, several attempts left',
      { status: 'wrong', remaining: 2 },
      true,
      { next: 'ready', wipe: false, error: { key: 'wrongPassword', params: { n: 2 } } },
    ],
  ]

  it.each(cases)('%s', (_name, result, hasPassword, expected) => {
    expect(nextStep(result, hasPassword)).toEqual(expected)
  })
})

describe('failureError', () => {
  it.each([
    ['network failure', new NetworkError(), 'errNetwork'],
    ['rejected request', new RequestError(400), 'errRequest'],
    ['anything else', new Error('boom'), 'errGeneric'],
    ['a non-error', 'boom', 'errGeneric'],
  ])('%s', (_name, cause, key) => {
    expect(failureError(cause)).toEqual({ key })
  })
})
