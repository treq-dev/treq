import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "./EChart";
import type { LogBucket } from "../lib/api-types";

interface Props {
	buckets: LogBucket[];
	/** Bucket width in seconds; used to fill gaps in the time axis. */
	bucketSeconds?: number;
	className?: string;
}

/** Severity order and colour, lowest first so ERROR stacks on top. */
const SERIES: { severity: string; label: string; color: string }[] = [
	{ severity: "INFO", label: "Info", color: "#60a5fa" },
	{ severity: "WARN", label: "Warn", color: "#f59e0b" },
	{ severity: "ERROR", label: "Error", color: "#ef4444" },
];

/** Cap on generated slots, so a wide time range can't produce a huge axis. */
const MAX_BUCKETS = 300;

function formatBucket(epochMs: number): string {
	return new Date(epochMs).toISOString().slice(11, 19);
}

/**
 * Build a gap-free, ascending list of bucket start times.
 *
 * The backend only returns buckets that had records, so quiet periods would
 * otherwise collapse and make bursts look adjacent. Filling the range keeps the
 * axis a real timeline.
 */
function buildTimeline(buckets: LogBucket[], stepSeconds: number): number[] {
	const times = buckets
		.map((b) => Date.parse(b.bucket))
		.filter((t) => !Number.isNaN(t));
	if (times.length === 0) return [];

	const step = Math.max(1, stepSeconds) * 1000;
	const first = Math.min(...times);
	const last = Math.max(...times);
	const slots = Math.floor((last - first) / step) + 1;

	// Too wide to fill: fall back to just the populated buckets, still sorted.
	if (slots > MAX_BUCKETS) {
		return [...new Set(times)].sort((a, b) => a - b);
	}

	return Array.from({ length: slots }, (_, i) => first + i * step);
}

/** Stacked count-over-time chart sitting above a logs feed. */
export function LogsTimeseriesChart({
	buckets,
	bucketSeconds = 1,
	className,
}: Props) {
	const option = useMemo<EChartsOption>(() => {
		// Ascending, so the oldest bucket is leftmost and the newest rightmost.
		const timeline = buildTimeline(buckets, bucketSeconds);
		const index = new Map(timeline.map((t, i) => [t, i]));

		const series = SERIES.map(({ severity, label, color }) => {
			const data = new Array<number>(timeline.length).fill(0);
			for (const bucket of buckets) {
				if (bucket.severity_text !== severity) continue;
				const at = index.get(Date.parse(bucket.bucket));
				if (at !== undefined) data[at] = bucket.count;
			}
			return {
				name: label,
				type: "bar" as const,
				stack: "total",
				barMaxWidth: 24,
				itemStyle: { color },
				emphasis: { focus: "series" as const },
				data,
			};
		});

		return {
			animation: false,
			// Legend can wrap to two lines in a narrow panel; grid.top reserves
			// enough room for that worst case so bars never run under it.
			grid: { left: 44, right: 16, top: 52, bottom: 26 },
			tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
			legend: {
				data: SERIES.map((s) => s.label),
				top: 2,
				left: "center",
				orient: "horizontal",
				icon: "roundRect",
				itemWidth: 8,
				itemHeight: 8,
				itemGap: 12,
				textStyle: { fontSize: 10 },
			},
			xAxis: {
				type: "category",
				data: timeline.map(formatBucket),
				axisTick: { alignWithLabel: true },
				axisLabel: { fontSize: 10, hideOverlap: true },
			},
			yAxis: {
				type: "value",
				minInterval: 1,
				axisLabel: { fontSize: 10 },
				splitLine: { lineStyle: { opacity: 0.3 } },
			},
			series,
		};
	}, [buckets, bucketSeconds]);

	return (
		<EChart
			data-testid="logs-timeseries-chart"
			option={option}
			height={170}
			className={className}
		/>
	);
}
