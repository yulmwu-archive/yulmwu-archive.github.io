import { Date, getDate } from './Date'
import { QuartzComponentConstructor, QuartzComponentProps } from './types'
import readingTime from 'reading-time'
import { classNames } from '../util/lang'
import { i18n } from '../i18n'
import { JSX } from 'preact'
import style from './styles/contentMeta.scss'

interface ContentMetaOptions {
	/**
	 * Whether to display reading time
	 */
	showReadingTime: boolean
	showComma: boolean
	showOriginalPostLink?: boolean
}

const defaultOptions: ContentMetaOptions = {
	showReadingTime: false,
	showComma: true,
	showOriginalPostLink: true,
}

export default ((opts?: Partial<ContentMetaOptions>) => {
	// Merge options with defaults
	const options: ContentMetaOptions = { ...defaultOptions, ...opts }

	function ContentMetadata({ cfg, fileData, displayClass }: QuartzComponentProps) {
		const text = fileData.text

		if (text) {
			const segments: (string | JSX.Element)[] = []

			// Display author if available
			if (fileData.frontmatter?.author) {
				segments.push(
					<a href="https://swua.kr">
						<span class="content-meta-author">{fileData.frontmatter.author}</span>
					</a>,
				)
			}

			if (fileData.dates) {
				segments.push(<Date date={getDate(cfg, fileData)!} locale={cfg.locale} />)
			}

			// Display reading time if enabled
			if (options.showReadingTime) {
				const { minutes, words: _words } = readingTime(text)
				const displayedTime = i18n(cfg.locale).components.contentMeta.readingTime({
					minutes: Math.ceil(minutes),
				})
				segments.push(<span>{displayedTime}</span>)
			}

			if (options.showOriginalPostLink && fileData.slug) {
				// const originalPostUrl = `https://velog.io/@yulmwu/${fileData.slug}`

				const slug =
					fileData.slug.split('-').length >= 3 ? fileData.slug.split('-').slice(3).join('-') : fileData.slug
				const originalPostUrl = `https://velog.io/@yulmwu/${slug}`

				const originalPostText = i18n(cfg.locale).components.contentMeta.originalPostLinkText

				segments.push(
					<a href={originalPostUrl} target="_blank" rel="noopener noreferrer">
						{originalPostText}

						<svg
							aria-hidden="true"
							className="external-icon"
							style="max-width:0.8em;max-height:0.8em; margin-left: 6px;"
							viewBox="0 0 512 512"
						>
							<path
								fill="currentColor"
								d="M432 320h-32a16 16 0 0 0-16 16v112H80V128h112a16 16 0 0 0 16-16v-32a16 16 0 0 0-16-16H64a64.07 64.07 0 0 0-64 64v320a64.07 64.07 0 0 0 64 64h320a64.07 64.07 0 0 0 64-64V336a16 16 0 0 0-16-16z"
							></path>
							<path
								fill="currentColor"
								d="M488 0h-128a24 24 0 0 0-24 24v32a24 24 0 0 0 24 24h42.69L201 243.69a24 24 0 0 0 0 33.94l22.63 22.63a24 24 0 0 0 33.94 0L453.26 114.59V157a24 24 0 0 0 24 24h32a24 24 0 0 0 24-24V24a24 24 0 0 0-24-24z"
							></path>
						</svg>
					</a>,
				)
			}

			return (
				<p show-comma={options.showComma} class={classNames(displayClass, 'content-meta')}>
					{segments}
				</p>
			)
		} else {
			return null
		}
	}

	ContentMetadata.css = style

	return ContentMetadata
}) satisfies QuartzComponentConstructor
