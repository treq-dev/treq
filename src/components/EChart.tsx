import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

interface Props {
	option: EChartsOption;
	/** CSS height; the chart fills its container's width. */
	height?: number | string;
	className?: string;
	"data-testid"?: string;
	/** Forwarded to ECharts init; pass "dark" to follow a dark UI. */
	theme?: string;
	onEvents?: Record<string, (params: unknown) => void>;
}

/**
 * Thin React wrapper around Apache ECharts.
 *
 * ECharts owns a canvas imperatively, so the instance lives in a ref across
 * renders and only the option object is pushed on update. Charts are disposed
 * on unmount to avoid leaking the canvas and its resize listener.
 */
export function EChart({
	option,
	height = 160,
	className,
	theme,
	onEvents,
	"data-testid": testId,
}: Props) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<echarts.ECharts | null>(null);

	// jsdom has no layout or canvas, so charts render as an empty box in tests.
	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;

		const chart = echarts.init(element, theme, { renderer: "svg" });
		chartRef.current = chart;

		const handleResize = () => chart.resize();
		window.addEventListener("resize", handleResize);

		// The container is often sized by flexbox after mount, so observe it too.
		const observer =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(handleResize)
				: null;
		observer?.observe(element);

		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", handleResize);
			chart.dispose();
			chartRef.current = null;
		};
	}, [theme]);

	useEffect(() => {
		// notMerge keeps a shrinking series list from leaving stale series behind.
		chartRef.current?.setOption(option, { notMerge: true });
	}, [option]);

	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !onEvents) return;
		for (const [name, handler] of Object.entries(onEvents)) {
			chart.on(name, handler);
		}
		return () => {
			for (const name of Object.keys(onEvents)) {
				chart.off(name);
			}
		};
	}, [onEvents]);

	return (
		<div
			ref={containerRef}
			data-testid={testId}
			className={className}
			style={{ height, width: "100%" }}
		/>
	);
}
