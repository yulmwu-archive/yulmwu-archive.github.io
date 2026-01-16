import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import { formatDate, getDate } from "../Date"
import style from "../styles/homePage.scss"
import { QuartzPluginData } from "../../plugins/vfile"

type PostsByDirectory = Map<string, QuartzPluginData[]>
type DirectoryTitles = Map<string, string>

const groupPostsByDirectory = (posts: QuartzPluginData[]): PostsByDirectory => {
	const postsByDirectory: PostsByDirectory = new Map()

	posts.forEach((post) => {
		const slug = post.slug || ""
		const parts = slug.split("/")
		const directory = parts.length > 1 ? parts.slice(0, -1).join("/") : "root"

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
		const slug = file.slug || ""
		if (slug.endsWith("index") && slug !== "index") {
			const directory = slug.replace(/\/index$/, "")
			if (!directoryTitles.has(directory)) {
				const title = file.frontmatter?.title || directory.split("/").pop() || directory
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
	return directories.sort((a, b) => {
		if (a === "root") return -1
		if (b === "root") return 1
		return a.localeCompare(b)
	})
}

const PostCard = ({ post, cfg }: { post: QuartzPluginData; cfg: any }) => {
	const date = getDate(cfg, post)
	const title = post.frontmatter?.title || post.slug
	const description = post.description || ""
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

const HomePage: QuartzComponent = ({ allFiles, cfg, fileData }: QuartzComponentProps) => {
	const posts = allFiles.filter((file) => file.slug && file.slug !== "index" && !file.slug.startsWith("tags/"))

	const postsByDirectory = groupPostsByDirectory(posts)
	sortPostsByDate(postsByDirectory, cfg)
	const directoryTitles = extractDirectoryTitles(postsByDirectory, allFiles)
	const sortedDirectories = sortDirectories(Array.from(postsByDirectory.keys()))

	return (
		<div class="home-page">
			<header class="home-header">
				<h1>Welcome to {cfg.pageTitle}</h1>
			</header>

			{sortedDirectories.map((directory) => (
				<div class="posts-section">
					{directory !== "root" && (
						<h2 class="section-title">
							{directoryTitles.get(directory) || directory.split("/").pop() || directory}
						</h2>
					)}
					<div class="posts-grid">
						{postsByDirectory.get(directory)!.map((post) => (
							<PostCard post={post} cfg={cfg} />
						))}
					</div>
				</div>
			))}
		</div>
	)
}

HomePage.css = style

export default (() => HomePage) satisfies QuartzComponentConstructor
