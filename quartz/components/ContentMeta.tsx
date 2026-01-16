import { Date, getDate } from "./Date"
import { QuartzComponentConstructor, QuartzComponentProps } from "./types"
import readingTime from "reading-time"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"
import { JSX } from "preact"
import style from "./styles/contentMeta.scss"

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

                const slug = fileData.slug.split("-").length >= 3
                    ? fileData.slug.split("-").slice(3).join("-")
                    : fileData.slug
                const originalPostUrl = `https://velog.io/@yulmwu/${slug}`

                const originalPostText = i18n(cfg.locale).components.contentMeta.originalPostLinkText

                segments.push(
                    <a href={originalPostUrl} target="_blank" rel="noopener noreferrer">
                        {originalPostText}
                    </a>
                )
            }

			return (
				<p show-comma={options.showComma} class={classNames(displayClass, "content-meta")}>
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
