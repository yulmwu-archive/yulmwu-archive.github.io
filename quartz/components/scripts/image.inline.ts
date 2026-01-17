document.addEventListener('DOMContentLoaded', () => {
	const images = document.querySelectorAll('article img')

	images.forEach((img) => {
		// Skip if image is already wrapped in a link
		if (img.parentElement?.tagName === 'A') {
			return
		}

		const src = img.getAttribute('src')
		if (src) {
			// Create a wrapper link
			const link = document.createElement('a')
			link.href = src
			link.target = '_blank'
			link.rel = 'noopener noreferrer'
			link.style.margin = '3rem auto'

			// Replace image with link-wrapped image
			img.parentNode?.insertBefore(link, img)
			link.appendChild(img)
		}
	})
})
