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
		Component.Search(),
		Component.Flex({
			components: [{ Component: Component.Darkmode() }, { Component: Component.ReaderMode() }],
		}),
	],
	right: [],
}

export const defaultContentPageLayout: PageLayout = {
	beforeBody: [
		Component.ConditionalRender({
			component: Component.Breadcrumbs({ showCurrentPage: false }),
			condition: (page) => page.fileData.slug !== 'index',
		}),
		Component.ArticleTitle(),
		Component.ContentMeta(),
		Component.TagList(),
		Component.SeriesNavigator(),
	],
	left: [
		Component.Search(),
		Component.Flex({
			components: [{ Component: Component.Darkmode() }, { Component: Component.ReaderMode() }],
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
		Component.Search(),
		Component.Flex({
			components: [{ Component: Component.Darkmode() }, { Component: Component.ReaderMode() }],
		}),
	],
	right: [Component.DesktopOnly(Component.TableOfContents())],
}
