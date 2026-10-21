import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-hello'

export function apply(_ctx: Context) {
	console.log('[dsh-hello] loaded')
}
