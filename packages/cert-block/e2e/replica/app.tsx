/**
 * The replica page: a storefront article as a Hydrogen app renders a Builder `blog-article` entry, as one React
 * document (the server streams it, the browser hydrates `document`), with an in-app navigation to a second article.
 *
 * Builder's React SDK (gen2) renders an entry's blocks as `<div class="builder-blocks">` holding one
 * `<div class="builder-block">` per block, a flex column; a registered component renders inside its block. The page
 * copies that structure and the column's styles, puts the brand's article copy around the CertREV block, and passes
 * the block the props the SDK passes `certRevCertComponent`: its options (here only the delivery marker the portal's
 * exporter writes) and `builderContext.content.id`.
 */

import * as React from 'react'
import { CertReviewCard } from '../../src/builder/cert-review-card.js'

export interface ReplicaArticle {
	readonly path: string
	readonly title: string
	/** The Builder entry id: the Delivery placement's `externalId`. */
	readonly entryId: string
	/** The block's `part`, as an editor sets it (absent: the whole card). */
	readonly part?: 'full' | 'header' | 'memo'
	/** A second CertREV block (a split banner's memo block) after the copy. */
	readonly memoBlock?: boolean
}

export const DELIVERY_ORIGIN = 'https://portal.certrev.com'

/** The theme's own styles: a storefront's article column, and Builder's block column. */
export const PAGE_CSS = `
html,body{margin:0;background:#fff}
body{font:17px/1.6 Georgia,'Times New Roman',serif;color:#222}
header{padding:12px 16px;border-bottom:1px solid #ddd}
header a{margin-right:16px;color:#a0005a}
main{max-width:760px;margin:0 auto;padding:24px 16px 120px}
h1{font-size:34px;line-height:1.2;margin:0 0 20px}
p{margin:0 0 18px}
.builder-blocks{display:flex;flex-direction:column;align-items:stretch}
.builder-block{display:flex;flex-direction:column;position:relative;flex-shrink:0;box-sizing:border-box}
`

const COPY = [
	'Retinol is one of the most studied ingredients in skincare. This guide covers how often to use it, what concentrations make sense for beginners, and how to pair it with the rest of a routine.',
	'Start low and slow: two or three evenings a week, a pea-sized amount, on dry skin. Increase only when your skin tolerates it, and always wear sunscreen during the day.',
	'Irritation, dryness and peeling are common in the first weeks. A plain moisturiser after application helps, and so does skipping other actives on retinol nights.',
	'If you are pregnant or breastfeeding, talk to a clinician first. People with sensitive skin may prefer a gentler retinoid or a lower strength.',
	'Results take time: most studies measure changes over twelve weeks or more, so consistency matters more than strength.',
]

function Block(props: { readonly children: React.ReactNode }) {
	return <div className="builder-block">{props.children}</div>
}

function CertBlock(props: { readonly entryId: string; readonly part?: ReplicaArticle['part'] }) {
	return (
		<Block>
			<CertReviewCard
				delivery={{ v: 1, baseUrl: DELIVERY_ORIGIN }}
				builderContext={{ content: { id: props.entryId } }}
				{...(props.part ? { part: props.part } : {})}
			/>
		</Block>
	)
}

function Article(props: { readonly article: ReplicaArticle }) {
	const { article } = props
	return (
		<article data-replica-entry={article.entryId}>
			<h1>{article.title}</h1>
			<div className="builder-blocks">
				<CertBlock entryId={article.entryId} part={article.part} />
				{COPY.map((text) => (
					<Block key={text}>
						<p>{text}</p>
					</Block>
				))}
				{article.memoBlock ? <CertBlock entryId={article.entryId} part="memo" /> : null}
			</div>
		</article>
	)
}

export function App(props: { readonly articles: readonly ReplicaArticle[]; readonly path: string }) {
	const [path, setPath] = React.useState(props.path)
	const article = props.articles.find((a) => a.path === path) ?? props.articles[0]
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{article.title}</title>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: the replica theme's own constant stylesheet */}
				<style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
			</head>
			<body>
				<header>
					{props.articles.map((a) => (
						<a
							key={a.path}
							href={a.path}
							data-replica-nav={a.path}
							onClick={(e) => {
								// The in-app navigation a Hydrogen storefront makes: no document load, the article renders on the client.
								e.preventDefault()
								window.history.pushState(null, '', a.path)
								setPath(a.path)
							}}
						>
							{a.title}
						</a>
					))}
				</header>
				<main>
					<Article key={article.path} article={article} />
				</main>
			</body>
		</html>
	)
}
