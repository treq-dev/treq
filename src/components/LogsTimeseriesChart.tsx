import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "./EChart";
import type { LogBucket } from "../lib/api-types";

interface Props {
	buckets: LogBucket[];
	className?: string;
}

/** Severity order and colour, lowest first so ERROR stacks on top. */
const SERIES: { severity: string; label: string; color: string }[] = [
	{ severity: "INFO", label: "Info", color: "#60a5fa" },
	{ severity: "WARN", label: "Warn", color: "#f59e0b" },
	{ severity: "ERROR", label: "Error", color: "#ef4444" },
];

function formatBucket(bucket: string): string {
	const parsed = new Date(bucket);
	if (Number.isNaN(parsed.getTime())) return bucket;
	return parsed.toISOString().slice(11, 19);
}

/** Stacked count-over-time chart sitting above a logs feed. */
export function LogsTimeseriesChart({ buckets, className }: Props) {
	const option = useMemo<EChartsOption>(() => {
		// Buckets arrive as one row per (time, severity); pivot to one series
		// per severity over a shared, sorted time axis.
		const times = Array.from(new Set(buckets.map((b) => b.bucket))).sort();
		const index = new Map(times.map((t, i) => [t, i]));

		const series = SERIES.map(({ severity, label, color }) => {
			const data = new Array<number>(times.length).fill(0);
			for (const bucket of buckets) {
				if (bucket.severity_text !== severity) continue;
				const at = index.get(bucket.bucket);
				if (at !== undefined) data[at] = bucket.count;
			}
			return {
				name: label,
				type: "bar" as const,
				stack: "total",
				itemStyle: { color },
				emphasis: { focus: "series" as const },
				data,
			};
		});

		return {
			animation: false,
			grid: { left: 44, right: 12, top: 28, bottom: 24 },
			tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
			legend: {
				data: SERIES.map((s) => s.label),
				top: 0,
				right: 0,
				icon: "roundRect",
				itemWidth: 8,
				itemHeight: 8,
				textStyle: { fontSize: 10 },
			},
			xAxis: {
				type: "category",
				data: times.map(formatBucket),
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
	}, [buckets]);

	return (
		<EChart
			data-testid="logs-timeseries-chart"
			option={option}
			height={150}
			className={className}
		/>
	);
}
