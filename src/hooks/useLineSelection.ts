import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Range selection over an ordered list of log lines.
 *
 * Two ways in: dragging across lines selects a contiguous run, and a
 * multi-select mode turns clicks into individual toggles for picking out
 * scattered lines.
 */
export function useLineSelection(lineCount: number) {
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [multiSelect, setMultiSelect] = useState(false);
	const [dragging, setDragging] = useState(false);
	const anchorRef = useRef<number | null>(null);
	// Selection is index-based, so it stops meaning anything if the feed changes.
	useEffect(() => {
		setSelected(new Set());
		anchorRef.current = null;
	}, [lineCount]);

	const selectRange = useCallback((from: number, to: number) => {
		const [start, end] = from <= to ? [from, to] : [to, from];
		const next = new Set<number>();
		for (let i = start; i <= end; i++) next.add(i);
		setSelected(next);
	}, []);

	const onLineMouseDown = useCallback(
		(index: number) => {
			if (multiSelect) {
				setSelected((prev) => {
					const next = new Set(prev);
					if (next.has(index)) {
						next.delete(index);
					} else {
						next.add(index);
					}
					return next;
				});
				return;
			}
			anchorRef.current = index;
			setDragging(true);
			setSelected(new Set([index]));
		},
		[multiSelect],
	);

	const onLineMouseEnter = useCallback(
		(index: number) => {
			if (!dragging || anchorRef.current === null) return;
			selectRange(anchorRef.current, index);
		},
		[dragging, selectRange],
	);

	// The pointer often leaves the feed before release, so end the drag globally.
	useEffect(() => {
		if (!dragging) return;
		const stop = () => setDragging(false);
		window.addEventListener("mouseup", stop);
		return () => window.removeEventListener("mouseup", stop);
	}, [dragging]);

	const clear = useCallback(() => {
		setSelected(new Set());
		anchorRef.current = null;
	}, []);

	const toggleMultiSelect = useCallback(() => {
		setMultiSelect((prev) => !prev);
		setSelected(new Set());
		anchorRef.current = null;
	}, []);

	const selectAll = useCallback(() => {
		setSelected(new Set(Array.from({ length: lineCount }, (_, i) => i)));
	}, [lineCount]);

	return {
		selected,
		multiSelect,
		dragging,
		onLineMouseDown,
		onLineMouseEnter,
		clear,
		toggleMultiSelect,
		selectAll,
	};
}
