import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"

const HomePage: QuartzComponent = ({ cfg }: QuartzComponentProps) => {
	return (
		<article class="popover-hint">
			<div class="home-page">
				<h1>Welcome to {cfg.pageTitle}</h1>
				<p>이곳에 홈페이지 컨텐츠를 커스터마이징하세요.</p>
				<p>
					이 컴포넌트는 <code>quartz/components/pages/HomePage.tsx</code>에서 수정할 수 있습니다.
				</p>
			</div>
		</article>
	)
}

export default (() => HomePage) satisfies QuartzComponentConstructor
