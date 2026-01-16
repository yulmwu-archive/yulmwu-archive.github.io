import path from "path"
import { QuartzEmitterPlugin } from "../types"
import { QuartzComponentProps } from "../../components/types"
import HeaderConstructor from "../../components/Header"
import BodyConstructor from "../../components/Body"
import { pageResources, renderPage } from "../../components/renderPage"
import { FullPageLayout } from "../../cfg"
import { FullSlug, pathToRoot } from "../../util/path"
import { defaultContentPageLayout, sharedPageComponents, homePageLayout } from "../../../quartz.layout"
import { Content } from "../../components"
import { styleText } from "util"
import { write } from "./helpers"
import { BuildCtx } from "../../util/ctx"
import { Node } from "unist"
import { StaticResources } from "../../util/resources"
import { QuartzPluginData } from "../vfile"

interface ContentPageOptions extends Partial<FullPageLayout> {
	useCustomHomePage?: boolean
	homePageLayout?: Partial<FullPageLayout>
}

async function processContent(
	ctx: BuildCtx,
	tree: Node,
	fileData: QuartzPluginData,
	allFiles: QuartzPluginData[],
	opts: FullPageLayout,
	resources: StaticResources,
) {
	const slug = fileData.slug!
	const cfg = ctx.cfg.configuration
	const externalResources = pageResources(pathToRoot(slug), resources)
	const componentData: QuartzComponentProps = {
		ctx,
		fileData,
		externalResources,
		cfg,
		children: [],
		tree,
		allFiles,
	}

	const content = renderPage(cfg, slug, componentData, opts, externalResources)
	return write({
		ctx,
		content,
		slug,
		ext: ".html",
	})
}

export const ContentPage: QuartzEmitterPlugin<ContentPageOptions> = (userOpts) => {
	const { useCustomHomePage, homePageLayout: customHomeLayout, ...layoutOpts } = userOpts || {}

	const opts: FullPageLayout = {
		...sharedPageComponents,
		...defaultContentPageLayout,
		pageBody: Content(),
		...layoutOpts,
	}

	// Setup home page layout
	const homeOpts: FullPageLayout = {
		...sharedPageComponents,
		...homePageLayout,
		pageBody: Content(),
		...customHomeLayout,
	}

	const { head: Head, header, beforeBody, pageBody, afterBody, left, right, footer: Footer } = opts
	const {
		head: HomeHead,
		header: homeHeader,
		beforeBody: homeBeforeBody,
		pageBody: homePageBody,
		afterBody: homeAfterBody,
		left: homeLeft,
		right: homeRight,
		footer: HomeFooter,
	} = homeOpts

	const Header = HeaderConstructor()
	const Body = BodyConstructor()

	return {
		name: "ContentPage",
		getQuartzComponents() {
			const defaultComponents = [
				Head,
				Header,
				Body,
				...header,
				...beforeBody,
				pageBody,
				...afterBody,
				...left,
				...right,
				Footer,
			]
			const homeComponents = [
				HomeHead,
				...homeHeader,
				...homeBeforeBody,
				homePageBody,
				...homeAfterBody,
				...homeLeft,
				...homeRight,
				HomeFooter,
			]
			// Return unique components
			return Array.from(new Set([...defaultComponents, ...homeComponents]))
		},
		async *emit(ctx, content, resources) {
			const allFiles = content.map((c) => c[1].data)
			let containsIndex = false

			for (const [tree, file] of content) {
				const slug = file.data.slug!
				if (slug === "index") {
					containsIndex = true
					// Use home page layout for index
					yield processContent(ctx, tree, file.data, allFiles, homeOpts, resources)
					continue
				}

				// only process home page, non-tag pages, and non-index pages
				if (slug.endsWith("/index") || slug.startsWith("tags/")) continue
				yield processContent(ctx, tree, file.data, allFiles, opts, resources)
			}

			if (!containsIndex && !useCustomHomePage) {
				console.log(
					styleText(
						"yellow",
						`\nWarning: you seem to be missing an \`index.md\` home page file at the root of your \`${ctx.argv.directory}\` folder (\`${path.join(ctx.argv.directory, "index.md")} does not exist\`). This may cause errors when deploying.`,
					),
				)
			}

			// If using custom home page and no index.md exists, generate home page
			if (useCustomHomePage && !containsIndex) {
				const homeSlug = "index"
				const cfg = ctx.cfg.configuration
				const externalResources = pageResources(pathToRoot(homeSlug as FullSlug), resources)
				const componentData: QuartzComponentProps = {
					ctx,
					fileData: {
						slug: homeSlug,
						frontmatter: { title: "Home" },
					} as QuartzPluginData,
					externalResources,
					cfg,
					children: [],
					tree: { type: "root", children: [] } as Node,
					allFiles,
				}

				const content = renderPage(cfg, homeSlug as FullSlug, componentData, homeOpts, externalResources)
				yield write({
					ctx,
					content,
					slug: homeSlug as FullSlug,
					ext: ".html",
				})
			}
		},
		async *partialEmit(ctx, content, resources, changeEvents) {
			const allFiles = content.map((c) => c[1].data)

			// find all slugs that changed or were added
			const changedSlugs = new Set<string>()
			for (const changeEvent of changeEvents) {
				if (!changeEvent.file) continue
				if (changeEvent.type === "add" || changeEvent.type === "change") {
					changedSlugs.add(changeEvent.file.data.slug!)
				}
			}

			for (const [tree, file] of content) {
				const slug = file.data.slug!
				if (!changedSlugs.has(slug)) continue
				if (slug.endsWith("/index") || slug.startsWith("tags/")) continue

				yield processContent(ctx, tree, file.data, allFiles, opts, resources)
			}
		},
	}
}
