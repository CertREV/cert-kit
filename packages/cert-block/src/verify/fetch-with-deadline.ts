/**
 * `fetchWithDeadline` — every network read on the render path gets a deadline.
 *
 * WHY: the verify layer runs INSIDE a server render (a Hydrogen loader, a Next server
 * component, a Builder server fetch). A hung origin with no deadline holds that render open
 * for as long as the runtime's socket timeout allows — one confirmed case was still pending
 * at 45 SECONDS, i.e. a page that never answered because a decorative badge could not be
 * verified. A badge is never worth a page: past the deadline the request is ABORTED (the
 * connection goes back) and the caller fails closed, the same safe outcome as any other
 * fetch failure.
 *
 * Two deliberate choices:
 *   • The deadline is enforced by a RACE, not by the AbortSignal alone. A `fetchImpl` that
 *     ignores its signal (a wrapper, a proxy, a non-conforming polyfill) must not be able to
 *     hold a render open. The abort still fires, so a conforming implementation also releases
 *     the socket rather than merely being abandoned.
 *   • `setTimeout` + `AbortController`, not `AbortSignal.timeout()`. The one-liner reads
 *     better but its timer is not the one a test's fake clock controls, and a deadline that
 *     can only be tested by really waiting is a deadline nobody keeps tested.
 */

/**
 * Default deadline for a render-path fetch. The Delivery API is CDN-cacheable and answers
 * well under a second at p99; three seconds is generous for a cold origin and still bounded
 * by what a page can afford to spend on a decoration whose failure mode is "render nothing".
 * Callers on a tighter TTFB budget pass their own.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 3_000

/**
 * `fetchImpl(url, init)` with a hard deadline. Rejects when the deadline passes (after
 * aborting the request); every caller on the verify path treats that rejection like any other
 * fetch failure — fail closed. A non-finite or non-positive `timeoutMs` is an explicit opt-out
 * (no deadline), for a caller that owns its own cancellation.
 */
export async function fetchWithDeadline(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchImpl(url, init)

	const controller = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort()
			reject(new Error(`cert-block: fetch exceeded its ${timeoutMs}ms deadline — ${url}`))
		}, timeoutMs)
	})

	try {
		// Promise.race subscribes to both, so an abort-rejection that lands after the race has
		// settled is still handled — it never surfaces as an unhandled rejection.
		return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), deadline])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}
