/**
 * Frozen goldens of OLDER releases (1.0.3, 1.1.1, 1.2.1) were recorded while the root printed an observability stamp,
 * ` data-certrev-rung="..."`, whenever a face was present. 3.0.0 prints no such attribute. The goldens are never
 * edited; a test that holds the current output to one of them removes the stamp from the golden first, so every
 * other byte still has to match the old release.
 */
export const stripLegacyStamp = (html: string): string => html.replace(/ data-certrev-rung="[^"]*"/g, '')

/**
 * A card's seed echoes the served render def. The old releases echoed the frozen `preset` / `rung` keys with it
 * (raw JSON, or HTML-escaped inside the wrapper's `data-certrev-envelope`); 3.0.0 parses neither, so its seed holds
 * neither. The goldens are read with that echo taken out, and the stamp too.
 */
export const stripLegacyEcho = (text: string): string =>
	stripLegacyStamp(text)
		.replace(/"preset":"[^"]*","rung":"[^"]*",/g, '')
		.replace(/&quot;preset&quot;:&quot;[^&]*&quot;,&quot;rung&quot;:&quot;[^&]*&quot;,/g, '')

/**
 * The same for a def the old release parsed: it copied the frozen `preset` and `rung` keys; 3.0.0 reads neither and
 * copies neither. Everything else the old release kept is still compared.
 */
export function stripLegacyDefKeys(parsed: unknown): unknown {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed
	const { preset: _preset, rung: _rung, ...rest } = parsed as Record<string, unknown>
	return rest
}
