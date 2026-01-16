import { ComponentChildren } from "preact"
import { htmlToJsx } from "../../util/jsx"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"

// @ts-ignore
import script from "../scripts/image.inline"

const Content: QuartzComponent = ({ fileData, tree }: QuartzComponentProps) => {
	const content = htmlToJsx(fileData.filePath!, tree) as ComponentChildren
	const classes: string[] = fileData.frontmatter?.cssclasses ?? []
	const classString = ["popover-hint", ...classes].join(" ")
	return <article class={classString}>{content}</article>
}

Content.afterDOMLoaded = script

export default (() => Content) satisfies QuartzComponentConstructor
