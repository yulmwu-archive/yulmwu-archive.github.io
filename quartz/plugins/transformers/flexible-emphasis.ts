import { QuartzTransformerPlugin } from '../types'
import { visit } from 'unist-util-visit'
import { Root, Text, Parent } from 'mdast'

export const FlexibleEmphasis: QuartzTransformerPlugin = () => {
	return {
		name: 'FlexibleEmphasis',
		markdownPlugins() {
			return [
				() => {
					return (tree: Root) => {
						visit(tree, 'text', (node: Text, index, parent: Parent | undefined) => {
							if (!parent || index === undefined) return

							const text = node.value
							// Match **text** (strong) or *text* (emphasis) patterns
							const emphasisPattern = /(\*\*[^*]+?\*\*|\*[^*]+?\*)/g

							if (emphasisPattern.test(text)) {
								const newNodes: any[] = []
								let lastIndex = 0
								const matches = text.matchAll(/(\*\*([^*]+?)\*\*|\*([^*]+?)\*)/g)

								for (const match of matches) {
									const matchIndex = match.index!

									// Add text before match
									if (matchIndex > lastIndex) {
										newNodes.push({
											type: 'text',
											value: text.slice(lastIndex, matchIndex),
										})
									}

									// Check if it's strong (**text**) or emphasis (*text*)
									if (match[2]) {
										// Strong pattern
										newNodes.push({
											type: 'strong',
											children: [
												{
													type: 'text',
													value: match[2],
												},
											],
										})
									} else if (match[3]) {
										// Emphasis pattern
										newNodes.push({
											type: 'emphasis',
											children: [
												{
													type: 'text',
													value: match[3],
												},
											],
										})
									}

									lastIndex = matchIndex + match[0].length
								}

								// Add remaining text
								if (lastIndex < text.length) {
									newNodes.push({
										type: 'text',
										value: text.slice(lastIndex),
									})
								}

								// Replace the node with new nodes
								if (newNodes.length > 0) {
									parent.children.splice(index, 1, ...newNodes)
								}
							}
						})
					}
				},
			]
		},
	}
}
