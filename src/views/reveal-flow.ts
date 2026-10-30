import { NetworkError, RequestError, type OpenResult } from '@/api'
import type { MessageKey } from '@/i18n'

export type Phase =
  'incomplete' | 'damaged' | 'ready' | 'revealed' | 'gone' | 'destroyed' | 'undecryptable'

export type RevealError = { key: MessageKey; params?: Record<string, number> }

export type Step =
  | { next: Exclude<Phase, 'ready' | 'undecryptable'>; wipe: true }
  | { next: 'ready'; wipe: false; error: RevealError }

export function nextStep(result: OpenResult, hasPassword: boolean): Step {
  if (result.status === 'ok') return { next: 'revealed', wipe: true }
  if (result.status === 'gone') return { next: 'gone', wipe: true }
  if (!hasPassword) return { next: 'damaged', wipe: true }
  if (result.remaining === 0) return { next: 'destroyed', wipe: true }
  return {
    next: 'ready',
    wipe: false,
    error: {
      key: result.remaining === 1 ? 'wrongPasswordOne' : 'wrongPassword',
      params: { n: result.remaining },
    },
  }
}

export function failureError(cause: unknown): RevealError {
  return {
    key:
      cause instanceof NetworkError
        ? 'errNetwork'
        : cause instanceof RequestError
          ? 'errRequest'
          : 'errGeneric',
  }
}
