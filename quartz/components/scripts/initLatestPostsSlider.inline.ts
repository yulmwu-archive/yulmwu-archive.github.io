function initLatestPostsSlider() {
	if (typeof document === 'undefined') {
		return
	}

	const initSwiper = () => {
		const script = document.createElement('script')
		script.src = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js'
		script.onload = function () {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if (typeof (window as any).Swiper !== 'undefined') {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				new (window as any).Swiper('#latestPostsSwiper', {
					slidesPerView: 3,
					spaceBetween: 20,
					loop: false,
					navigation: {
						nextEl: '.swiper-button-next',
						prevEl: '.swiper-button-prev',
					},
					touchEventsTarget: 'container',
					allowTouchMove: true,
					breakpoints: {
						320: {
							slidesPerView: 1,
							spaceBetween: 10,
						},
						640: {
							slidesPerView: 1.5,
							spaceBetween: 12,
						},
						768: {
							slidesPerView: 2,
							spaceBetween: 15,
						},
						1024: {
							slidesPerView: 2.5,
							spaceBetween: 15,
						},
						1280: {
							slidesPerView: 3,
							spaceBetween: 20,
						},
					},
				})
			}
		}
		document.head.appendChild(script)
	}

	const loadSwiperCSS = () => {
		const link = document.createElement('link')
		link.rel = 'stylesheet'
		link.href = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css'
		document.head.appendChild(link)
	}

	loadSwiperCSS()
	initSwiper()
}

initLatestPostsSlider()
