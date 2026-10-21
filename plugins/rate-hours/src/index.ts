/**
 * dsh-rate-hours — host half.
 *
 * The badge is computed entirely in the browser, so this half exists only to
 * give the Loader a row: client-modules discovers browser bundles by scanning
 * enabled Loader entries for a `dsh.client` declaration. It registers no
 * service, no route, and no RPC, and contributes nothing to the model.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-rate-hours'

export function apply(_ctx: Context) {}
