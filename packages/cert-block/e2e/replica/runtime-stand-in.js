/*
 * STAND-IN for CertREV's hosted card runtime (sibling mission S2), used by the replica harness until S2's runtime is
 * served. It does only what the runtime's dialog contract says (S2 relay 887000a95451), and nothing for the dialogs'
 * look or their focus behaviour: those are the native <dialog>'s and the server's markup. A control carrying
 * `data-certrev-modal-open` ("expert": the profile; anything else: the certificate) opens the matching dialog host
 * among its own part host's siblings, else the first in the document with the same placement, with showModal(); a
 * control carrying `data-certrev-modal-close` closes its dialog. Init is idempotent (one global guard).
 */
;(() => {
	const GUARD = Symbol.for('certrev.card-runtime')
	if (document[GUARD]) return
	document[GUARD] = true
	const dialogFor = (control) => {
		const host = control.getRootNode().host
		if (!host) return null
		const want = control.getAttribute('data-certrev-modal-open') === 'expert' ? 'dialog-expert' : 'dialog-certificate'
		const selector = `certrev-card[data-certrev-part="${want}"][data-certrev-external-id="${host.getAttribute('data-certrev-external-id')}"]`
		const sibling = host.parentElement?.querySelector(`:scope > ${selector}`) ?? null
		const target = sibling || document.querySelector(selector)
		return target?.shadowRoot?.querySelector('dialog') ?? null
	}
	document.addEventListener(
		'click',
		(event) => {
			for (const node of event.composedPath()) {
				if (!(node instanceof Element)) continue
				if (node.hasAttribute('data-certrev-modal-close')) {
					const dialog = node.closest('dialog')
					if (dialog) dialog.close()
					return
				}
				if (node.hasAttribute('data-certrev-modal-open')) {
					const dialog = dialogFor(node)
					if (dialog && !dialog.open) {
						event.preventDefault()
						dialog.showModal()
					}
					return
				}
			}
		},
		true,
	)
})()
