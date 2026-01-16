import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from './types'
import { classNames } from '../util/lang'
import { pathToRoot } from '../util/path'
import style from './styles/seriesNavigator.scss'

interface SeriesNavigatorOptions {
	showCount?: boolean
	collapsible?: boolean
	defaultCollapsed?: boolean
}

const defaultOptions: SeriesNavigatorOptions = {
	showCount: true,
	collapsible: true,
	defaultCollapsed: true,
}

export default ((userOpts?: Partial<SeriesNavigatorOptions>) => {
	const opts = { ...defaultOptions, ...userOpts }

	const SeriesNavigator: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
		const seriesName = fileData.frontmatter?.series?.name
		const seriesSlug = fileData.frontmatter?.series?.slug

		if (!seriesName || !seriesSlug) {
			return null
		}

		// Filter all files that belong to the same series
		const seriesFiles = allFiles
			.filter((file) => {
				const fileSeries = file.frontmatter?.series
				return fileSeries && fileSeries.slug === seriesSlug
			})
			.sort((a, b) => {
				// Sort by date (oldest first)
				const dateA = a.dates?.created ? new Date(a.dates.created).getTime() : 0
				const dateB = b.dates?.created ? new Date(b.dates.created).getTime() : 0
				return dateA - dateB
			})

		if (seriesFiles.length <= 1) {
			return null
		}

		const currentIndex = seriesFiles.findIndex((file) => file.slug === fileData.slug)
		const baseDir = pathToRoot(fileData.slug!)

		return (
			<div class={classNames(displayClass, 'series-navigator')}>
				<details open={!opts.defaultCollapsed}>
					<summary>
						<h3>{seriesName}</h3>
						{opts.showCount && (
							<span class="series-count">
								{currentIndex + 1}/{seriesFiles.length}
							</span>
						)}
					</summary>
					<ol class="series-list">
						{seriesFiles.map((file, index) => {
							const isCurrent = file.slug === fileData.slug
							const title = file.frontmatter?.title || 'Untitled'
							const url = new URL(file.slug as string, `https://articles.swua.kr/${baseDir}`).pathname

							return (
								<li class={isCurrent ? 'current' : ''} key={index}>
									{isCurrent ? <span class="current-post">{title}</span> : <a href={url}>{title}</a>}
								</li>
							)
						})}
					</ol>
				</details>
			</div>
		)
	}

	SeriesNavigator.css = style

	return SeriesNavigator
}) satisfies QuartzComponentConstructor
