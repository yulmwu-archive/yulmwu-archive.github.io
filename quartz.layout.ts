import { PageLayout, SharedLayout } from './quartz/cfg'
import * as Component from './quartz/components'

export const sharedPageComponents: SharedLayout = {
	head: Component.Head(),
	header: [],
	afterBody: [],
	footer: Component.Footer({
		links: {
			GitHub: 'https://github.com/yulmwu',
			Linkedin: 'https://www.linkedin.com/in/yulmwu/',
			Velog: 'https://velog.io/@yulmwu',
		},
	}),
}

export const homePageLayout: PageLayout = {
	beforeBody: [Component.HomePage()],
	left: [
		Component.PageTitle(),
		Component.Flex({
			components: [
				{ Component: Component.Search(), grow: true },
				{ Component: Component.Darkmode() },
				{ Component: Component.ReaderMode() },
			],
		}),
	],
	right: [Component.Graph()],
}

export const defaultContentPageLayout: PageLayout = {
	beforeBody: [
		Component.ConditionalRender({
			component: Component.Breadcrumbs({ showCurrentPage: false }),
			condition: (page) => page.fileData.slug !== 'index',
		}),
		Component.ArticleTitle(),
		Component.ContentMeta(),
		Component.SeriesNavigator(),
	],
	afterBody: [Component.TagList()],
	left: [
		Component.PageTitle(),
		Component.Flex({
			components: [
				{ Component: Component.Search(), grow: true },
				{ Component: Component.Darkmode() },
				{ Component: Component.ReaderMode() },
			],
		}),
	],
	right: [Component.DesktopOnly(Component.TableOfContents())],
}

export const defaultListPageLayout: PageLayout = {
	beforeBody: [
		Component.ConditionalRender({
			component: Component.Breadcrumbs({ showCurrentPage: false }),
			condition: (page) => page.fileData.slug !== 'index',
		}),
		Component.ArticleTitle(),
		Component.ContentMeta(),
		Component.TagList(),
	],
	left: [
		Component.PageTitle(),
		Component.Flex({
			components: [
				{ Component: Component.Search(), grow: true },
				{ Component: Component.Darkmode() },
				{ Component: Component.ReaderMode() },
			],
		}),
	],
	right: [Component.DesktopOnly(Component.TableOfContents())],
}
