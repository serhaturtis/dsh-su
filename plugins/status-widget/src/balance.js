/**
 * Balance access, kept free of Cordis so it can be tested with a fake fetch.
 *
 * The DeepSeek balance endpoint is documented at
 * https://api-docs.deepseek.com/api/get-user-balance:
 *
 *   GET https://api.deepseek.com/user/balance
 *   Authorization: Bearer <key>
 *   -> { is_available: boolean,
 *        balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
 *
 * Every amount is a decimal *string*, not a number — they are passed through
 * untouched so the UI never introduces float error into someone's money.
 */

/** Default origin; overridable for tests and for a self-hosted gateway. */
export const DEFAULT_ORIGIN = 'https://api.deepseek.com'

const BALANCE_PATH = '/user/balance'

/**
 * Reduce a response body to what the widget shows, or to a reason it cannot.
 *
 * @param body - parsed JSON from the balance endpoint.
 * @returns `{ ok: true, available, balances }` or `{ ok: false, reason }`.
 */
export function normalizeBalance(body) {
	if (body === null || typeof body !== 'object') return { ok: false, reason: 'malformed' }
	const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
	const balances = []
	for (const info of infos) {
		if (info === null || typeof info !== 'object') continue
		const currency = typeof info.currency === 'string' ? info.currency : undefined
		const total = typeof info.total_balance === 'string' ? info.total_balance : undefined
		if (currency === undefined || total === undefined) continue
		balances.push({
			currency,
			total,
			granted: typeof info.granted_balance === 'string' ? info.granted_balance : undefined,
			toppedUp: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : undefined,
		})
	}
	if (balances.length === 0) return { ok: false, reason: 'no-balance-info' }
	return { ok: true, available: body.is_available === true, balances }
}

/**
 * One balance read.
 *
 * @param options.apiKey - the resolved credential value.
 * @param options.origin - API origin, without a trailing slash.
 * @param options.fetchImpl - injected for tests; defaults to global fetch.
 * @param options.timeoutMs - abort budget for one request.
 * @returns the normalized result, or `{ ok: false, reason }` never throwing.
 */
export async function fetchBalance({ apiKey, origin = DEFAULT_ORIGIN, fetchImpl = fetch, timeoutMs = 8000 }) {
	try {
		const response = await fetchImpl(`${origin}${BALANCE_PATH}`, {
			method: 'GET',
			headers: {
				authorization: `Bearer ${apiKey}`,
				accept: 'application/json',
			},
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (!response.ok) return { ok: false, reason: `http-${response.status}` }
		return normalizeBalance(await response.json())
	} catch (error) {
		const name = error instanceof Error ? error.name : 'unknown'
		return { ok: false, reason: name === 'TimeoutError' ? 'timeout' : 'network' }
	}
}

/**
 * A cache that answers a read at most once per `ttlMs`.
 *
 * The widget polls; the API does not need to be asked on every poll, and a
 * failed read is remembered too — a broken key should not turn into a request
 * every second.
 *
 * @param options.ttlMs - how long a successful read stays fresh.
 * @param options.read - the expensive operation.
 * @param options.now - clock, injected for tests.
 */
export function createBalanceCache({ ttlMs = 30_000, read, now = Date.now }) {
	let cached
	let at = 0
	let inFlight

	return async function balance() {
		const current = now()
		if (cached !== undefined && current - at < ttlMs) return cached
		if (inFlight !== undefined) return inFlight
		inFlight = (async () => {
			try {
				// The read may hang on a credential store; the cache must not.
				const value = await Promise.race([
					read(),
					new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 10_000).unref?.()),
				])
				cached = value
				at = now()
				return value
			} finally {
				inFlight = undefined
			}
		})()
		return inFlight
	}
}
