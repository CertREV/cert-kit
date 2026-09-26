/**
 * Public names kept only so a patch release never breaks a compiling integration (the semver
 * contract at the head of CHANGELOG.md). Each one does nothing it used to do; removal is for 2.0.
 */

/** Dispatched on the document, once per document, on the first call of a removed API, so a caller
 *  that still relies on it can see that it does nothing. `detail: { api, removedIn }`. */
export const DEPRECATED_API_EVENT = 'certrev:deprecated-api'

/** Documents that have already been told, so repeated calls dispatch once. */
const announcedDocs = new WeakSet<Document>()

/**
 * @deprecated Removed in 1.1.1: the runtime FTC disclosure guard is gone. This installs nothing,
 * checks nothing and never hides or replaces a face; whether a face shows its disclosure is settled
 * where the face is configured. The first call per document dispatches {@link DEPRECATED_API_EVENT}.
 * Will be deleted in 2.0.
 */
export function installFtcGuard(doc: Document): void {
	if (announcedDocs.has(doc)) return
	announcedDocs.add(doc)
	doc.dispatchEvent(
		new CustomEvent(DEPRECATED_API_EVENT, { detail: { api: 'installFtcGuard', removedIn: '1.1.1' } }),
	)
}
