import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from '../types'
import { formatDate, getDate } from '../Date'
import style from '../styles/homePage.scss'
import { QuartzPluginData } from '../../plugins/vfile'
// @ts-ignore
import script from '../scripts/initLatestPostsSlider.inline'

type PostsByDirectory = Map<string, QuartzPluginData[]>
type DirectoryTitles = Map<string, string>

const getLatestPosts = (posts: QuartzPluginData[], limit: number = 10): QuartzPluginData[] => {
	return posts.slice(0, limit)
}

const groupPostsByDirectory = (posts: QuartzPluginData[]): PostsByDirectory => {
	const postsByDirectory: PostsByDirectory = new Map()

	posts.forEach((post) => {
		const slug = post.slug || ''
		const parts = slug.split('/')
		const directory = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root'

		if (!postsByDirectory.has(directory)) {
			postsByDirectory.set(directory, [])
		}
		postsByDirectory.get(directory)!.push(post)
	})

	return postsByDirectory
}

const extractDirectoryTitles = (postsByDirectory: PostsByDirectory, allFiles: QuartzPluginData[]): DirectoryTitles => {
	const directoryTitles: DirectoryTitles = new Map()

	postsByDirectory.forEach((posts, directory) => {
		if (posts.length > 0) {
			const firstPost = posts[0]
			const seriesName = firstPost.frontmatter?.series?.name
			if (seriesName) {
				directoryTitles.set(directory, seriesName)
				return
			}
		}
	})

	allFiles.forEach((file) => {
		const slug = file.slug || ''
		if (slug.endsWith('index') && slug !== 'index') {
			const directory = slug.replace(/\/index$/, '')
			if (!directoryTitles.has(directory)) {
				const title = file.frontmatter?.title || directory.split('/').pop() || directory
				directoryTitles.set(directory, title)
			}
		}
	})

	return directoryTitles
}

const sortPostsByDate = (postsByDirectory: PostsByDirectory, cfg: any) => {
	postsByDirectory.forEach((groupPosts) => {
		groupPosts.sort((a, b) => {
			const dateA = getDate(cfg, a)
			const dateB = getDate(cfg, b)
			if (!dateA || !dateB) return 0
			return dateB.getTime() - dateA.getTime()
		})
	})
}

const sortDirectories = (directories: string[]): string[] => {
	const priority: Record<string, number> = {
		aws: 0,
		kubernetes: 1,
		cloudflare: 2,
		misc: 998,
		root: 999,
	}

	return directories.sort((a, b) => {
		const aPriority = priority[a.toLowerCase()] ?? 100
		const bPriority = priority[b.toLowerCase()] ?? 100

		if (aPriority !== bPriority) {
			return aPriority - bPriority
		}

		return a.localeCompare(b)
	})
}

const PostCard = ({ post, cfg }: { post: QuartzPluginData; cfg: any }) => {
	const date = getDate(cfg, post)
	const title = post.frontmatter?.title || post.slug
	const description = post.description || ''
	const tags = post.frontmatter?.tags || []

	return (
		<a href={`/${post.slug}`} class="post-card">
			<div class="post-card-content">
				<h3 class="post-title">{title}</h3>
				{description && <p class="post-description">{description}</p>}
				<div class="post-meta">
					{date && (
						<time datetime={date.toISOString()} class="post-date">
							{formatDate(date, cfg.locale)}
						</time>
					)}
					{tags.length > 0 && (
						<div class="post-tags">
							{tags.slice(0, 3).map((tag) => (
								<span class="post-tag">{tag}</span>
							))}
						</div>
					)}
				</div>
			</div>
		</a>
	)
}

const LatestPostsSlider = ({ posts, cfg }: { posts: QuartzPluginData[]; cfg: any }) => {
	if (posts.length === 0) return null

	return (
		<div class="latest-posts-section">
			<h2 class="latest-posts-title">최신 게시글 (10개)</h2>
			<div class="swiper-container" id="latestPostsSwiper">
				<div class="swiper-wrapper">
					{posts.map((post) => (
						<div class="swiper-slide">
							<PostCard post={post} cfg={cfg} />
						</div>
					))}
				</div>
				<div class="swiper-button-prev"></div>
				<div class="swiper-button-next"></div>
			</div>
		</div>
	)
}

const CollapsibleSection = ({
	directory,
	posts,
	directoryTitles,
	cfg,
}: {
	directory: string
	posts: QuartzPluginData[]
	directoryTitles: DirectoryTitles
	cfg: any
}) => {
	const title = directoryTitles.get(directory) || directory.split('/').pop() || directory
	const checkboxId = `section-${directory.replace(/\//g, '-')}`
	const postCount = posts.length

	return (
		<div class="posts-section">
			{directory !== 'root' && (
				<>
					<input type="checkbox" id={checkboxId} class="section-toggle" defaultChecked />
					<label htmlFor={checkboxId} class="section-header">
						<span class="expand-icon" aria-hidden="true"></span>
						<h2 class="section-title">{title}</h2>
						<span class="post-count">{postCount}</span>
					</label>
				</>
			)}
			<div class="posts-grid">
				{posts.map((post) => (
					<PostCard post={post} cfg={cfg} />
				))}
			</div>
		</div>
	)
}

const HomePage: QuartzComponent = ({ allFiles, cfg }: QuartzComponentProps) => {
	const posts = allFiles.filter((file) => file.slug && file.slug !== 'index' && !file.slug.startsWith('tags/'))

	const sortedPosts = posts.sort((a, b) => {
		const dateA = getDate(cfg, a)
		const dateB = getDate(cfg, b)
		if (!dateA || !dateB) return 0
		return dateB.getTime() - dateA.getTime()
	})

	const latestPosts = getLatestPosts(sortedPosts, 10)

	const postsByDirectory = groupPostsByDirectory(posts)
	sortPostsByDate(postsByDirectory, cfg)
	const directoryTitles = extractDirectoryTitles(postsByDirectory, allFiles)
	const sortedDirectories = sortDirectories(Array.from(postsByDirectory.keys()))

	return (
		<div class="home-page">
			<header class="home-header">
				<h1>Mirror of {cfg.pageTitle} Blog</h1>
				<p>
					원본 블로그 포스팅은{' '}
					<a href="https://velog.io/@yulmwu" target="_blank" rel="noopener noreferrer">
						Velog에서 확인하실 수 있습니다.
					</a>
				</p>
				<p>
					본 페이지는 아카이브/미러링 용도로 사용되며, 모든 컨텐츠의 저작권은 원저작자에게 있습니다.
					(라이선스: CC-BY-SA)
				</p>
			</header>

			<LatestPostsSlider posts={latestPosts} cfg={cfg} />

			<h2 class="all-posts-title">시리즈별 게시글</h2>

			{sortedDirectories.map((directory) => (
				<CollapsibleSection
					key={directory}
					directory={directory}
					posts={postsByDirectory.get(directory)!}
					directoryTitles={directoryTitles}
					cfg={cfg}
				/>
			))}
		</div>
	)
}

HomePage.afterDOMLoaded = script
HomePage.css = style

export default (() => HomePage) satisfies QuartzComponentConstructor
