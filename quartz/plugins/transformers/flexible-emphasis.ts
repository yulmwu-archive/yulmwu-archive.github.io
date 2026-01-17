import { QuartzTransformerPlugin } from '../types'
import { Root, Parent, Text } from 'mdast'

type MdastNode = any

const shouldSkipParent = (node: any) => {
	return (
		node.type === 'strong' ||
		node.type === 'emphasis' ||
		node.type === 'inlineCode' ||
		node.type === 'code' ||
		node.type === 'link' ||
		node.type === 'image' ||
		node.type === 'html'
	)
}

const isValidInline = (s: string) => s.trim().length > 0

const splitEmphasis = (value: string): MdastNode[] => {
	const out: MdastNode[] = []
	const n = value.length
	let i = 0

	const pushText = (s: string) => {
		if (s) out.push({ type: 'text', value: s })
	}

	const findSingleStarClose = (start: number) => {
		let j = start + 1
		while (j < n) {
			const k = value.indexOf('*', j)
			if (k === -1) return -1
			const prev = k > 0 ? value[k - 1] : ''
			const next = k + 1 < n ? value[k + 1] : ''
			if (prev !== '*' && next !== '*') return k
			j = k + 1
		}
		return -1
	}

	while (i < n) {
		const star = value.indexOf('*', i)
		if (star === -1) {
			pushText(value.slice(i))
			break
		}

		pushText(value.slice(i, star))

		if (value[star + 1] === '*') {
			const close = value.indexOf('**', star + 2)
			if (close !== -1) {
				const content = value.slice(star + 2, close)
				if (isValidInline(content)) {
					out.push({ type: 'strong', children: [{ type: 'text', value: content }] })
					i = close + 2
					continue
				}
			}
			pushText('*')
			i = star + 1
			continue
		}

		const prev = star > 0 ? value[star - 1] : ''
		const next = star + 1 < n ? value[star + 1] : ''
		if (prev === '*' || next === '*') {
			pushText('*')
			i = star + 1
			continue
		}

		const close = findSingleStarClose(star)
		if (close !== -1) {
			const content = value.slice(star + 1, close)
			if (isValidInline(content)) {
				out.push({ type: 'emphasis', children: [{ type: 'text', value: content }] })
				i = close + 1
				continue
			}
		}

		pushText('*')
		i = star + 1
	}

	return out
}

const walk = (node: any) => {
	if (!node || typeof node !== 'object') return
	if (shouldSkipParent(node)) return
	if (!Array.isArray(node.children)) return

	for (let i = 0; i < node.children.length; i++) {
		const child = node.children[i]
		if (!child) continue

		if (child.type === 'text') {
			const textNode = child as Text
			const v = textNode.value
			if (!v || v.indexOf('*') === -1) continue

			const replaced = splitEmphasis(v)
			if (replaced.length === 1 && replaced[0].type === 'text' && replaced[0].value === v) continue

			node.children.splice(i, 1, ...replaced)
			i += replaced.length - 1
			continue
		}

		if ((child as Parent).children) walk(child)
	}
}

export const FlexibleEmphasis: QuartzTransformerPlugin = () => {
	return {
		name: 'FlexibleEmphasis',
		markdownPlugins() {
			return [
				() => {
					return (tree: Root) => {
						walk(tree)
					}
				},
			]
		},
	}
}
