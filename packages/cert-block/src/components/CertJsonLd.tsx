/**
 * <CertJsonLd> — emits the projected schema.org graph as a
 * `<script type="application/ld+json">`.
 *
 * The JSON-LD is PROJECTED from the verified facts (never stored in the envelope — see
 * the projector). SSR-safe: it renders a single <script> whose body is the serialized
 * graph with `<` neutralized so it can't break out of the script tag (standard
 * dangerouslySetInnerHTML-for-JSON-LD pattern; the content is our own deterministic
 * serialization of trusted-shape data, not arbitrary HTML).
 *
 * Place it inside the page <head> (Next: in a layout/head; Hydrogen: in the route
 * component — React 19 hoists <script> in <head>) so crawlers read structured data
 * without client JS.
 */

import type { CertPayload } from '../contract/kernel.js'
import { projectCertJsonLd, type ProjectJsonLdOptions, serializeJsonLdForScript } from '../jsonld/project.js'

export interface CertJsonLdProps extends ProjectJsonLdOptions {
	readonly payload: CertPayload
	/** Optional id on the <script> so a page can find/replace it deterministically. */
	readonly scriptId?: string
}

export function CertJsonLd(props: CertJsonLdProps) {
	const { payload, scriptId, ...opts } = props
	const json = serializeJsonLdForScript(projectCertJsonLd(payload, opts))
	return (
		<script
			type="application/ld+json"
			id={scriptId}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires raw script body; the content is our deterministic serialization with `<` neutralized (serializeJsonLdForScript), not arbitrary HTML.
			dangerouslySetInnerHTML={{ __html: json }}
		/>
	)
}
