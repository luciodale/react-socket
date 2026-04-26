import { useCallback, useEffect, useRef, useState } from "react";
import type { TInspectorPosition } from "./inspector-types";

type TPoint = { x: number; y: number };
type TSize = { width: number; height: number };

type TStoredLayout = {
	bubble: TPoint;
	panel: TPoint;
	size: TSize;
	sidebarWidth: number;
};

const STORAGE_KEY = "rsi-layout";
const PANEL_W = 680;
const PANEL_H = 420;
const BUBBLE_W = 80;
const BUBBLE_H = 32;
const MIN_W = 480;
const MIN_H = 300;
const SIDEBAR_W = 280;
const SIDEBAR_MIN = 150;
const DRAG_THRESHOLD = 4;

function computeInitialPosition(
	anchor: TInspectorPosition,
	w: number,
	h: number,
): TPoint {
	const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
	const vh = typeof window !== "undefined" ? window.innerHeight : 768;
	const m = 16;
	switch (anchor) {
		case "top-left":
			return { x: m, y: m };
		case "top-right":
			return { x: vw - w - m, y: m };
		case "bottom-left":
			return { x: m, y: vh - h - m };
		case "bottom-right":
			return { x: vw - w - m, y: vh - h - m };
	}
}

function clampToViewport(pos: TPoint, w: number, h: number): TPoint {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	return {
		x: Math.max(0, Math.min(vw - Math.min(w, vw), pos.x)),
		y: Math.max(0, Math.min(vh - Math.min(h, vh), pos.y)),
	};
}

function readStoredLayout(): TStoredLayout | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as TStoredLayout;
	} catch {
		return null;
	}
}

function writeStoredLayout(layout: TStoredLayout) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
	} catch {
		// localStorage unavailable
	}
}

type TDragOptions = {
	onStart: () => (delta: { dx: number; dy: number }) => void;
	onClick?: () => void;
	threshold?: number;
	stopPropagation?: boolean;
	ignoreOnButton?: boolean;
};

function createDrag(opts: TDragOptions): (e: React.MouseEvent) => void {
	return (e) => {
		if (opts.ignoreOnButton && (e.target as HTMLElement).closest("button"))
			return;
		e.preventDefault();
		if (opts.stopPropagation) e.stopPropagation();

		const startX = e.clientX;
		const startY = e.clientY;
		const threshold = opts.threshold ?? 0;
		let moved = threshold === 0;
		const handle = opts.onStart();

		function onMouseMove(ev: MouseEvent) {
			const dx = ev.clientX - startX;
			const dy = ev.clientY - startY;
			if (!moved && Math.abs(dx) < threshold && Math.abs(dy) < threshold)
				return;
			moved = true;
			handle({ dx, dy });
		}

		function onMouseUp() {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			if (!moved && opts.onClick) opts.onClick();
		}

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	};
}

export function useInspectorDrag(
	anchor: TInspectorPosition,
	onToggle: () => void,
) {
	const [bubblePosition, setBubblePosition] = useState<TPoint>(() => {
		const stored = readStoredLayout();
		if (stored?.bubble)
			return clampToViewport(stored.bubble, BUBBLE_W, BUBBLE_H);
		return computeInitialPosition(anchor, BUBBLE_W, BUBBLE_H);
	});
	const [panelPosition, setPanelPosition] = useState<TPoint>(() => {
		const stored = readStoredLayout();
		if (stored?.panel) return clampToViewport(stored.panel, PANEL_W, PANEL_H);
		return computeInitialPosition(anchor, PANEL_W, PANEL_H);
	});
	const [size, setSize] = useState<TSize>(() => {
		const stored = readStoredLayout();
		if (stored?.size)
			return {
				width: Math.max(MIN_W, stored.size.width),
				height: Math.max(MIN_H, stored.size.height),
			};
		return { width: PANEL_W, height: PANEL_H };
	});
	const [sidebarWidth, setSidebarWidth] = useState(() => {
		const stored = readStoredLayout();
		if (stored?.sidebarWidth) return Math.max(SIDEBAR_MIN, stored.sidebarWidth);
		return SIDEBAR_W;
	});

	const bubblePosRef = useRef(bubblePosition);
	bubblePosRef.current = bubblePosition;
	const panelPosRef = useRef(panelPosition);
	panelPosRef.current = panelPosition;
	const sizeRef = useRef(size);
	sizeRef.current = size;
	const sidebarWidthRef = useRef(sidebarWidth);
	sidebarWidthRef.current = sidebarWidth;
	const onToggleRef = useRef(onToggle);
	onToggleRef.current = onToggle;

	useEffect(() => {
		writeStoredLayout({
			bubble: bubblePosition,
			panel: panelPosition,
			size,
			sidebarWidth,
		});
	}, [bubblePosition, panelPosition, size, sidebarWidth]);

	const onBubbleDown = useCallback(
		createDrag({
			ignoreOnButton: true,
			threshold: DRAG_THRESHOLD,
			onStart: () => {
				const start = { ...bubblePosRef.current };
				return ({ dx, dy }) =>
					setBubblePosition(
						clampToViewport(
							{ x: start.x + dx, y: start.y + dy },
							BUBBLE_W,
							BUBBLE_H,
						),
					);
			},
			onClick: () => onToggleRef.current(),
		}),
		[],
	);

	const onHeaderDown = useCallback(
		createDrag({
			ignoreOnButton: true,
			onStart: () => {
				const start = { ...panelPosRef.current };
				const { width, height } = sizeRef.current;
				return ({ dx, dy }) =>
					setPanelPosition(
						clampToViewport(
							{ x: start.x + dx, y: start.y + dy },
							width,
							height,
						),
					);
			},
		}),
		[],
	);

	const onResizeDown = useCallback(
		createDrag({
			stopPropagation: true,
			onStart: () => {
				const start = { ...sizeRef.current };
				return ({ dx, dy }) =>
					setSize({
						width: Math.max(MIN_W, start.width + dx),
						height: Math.max(MIN_H, start.height + dy),
					});
			},
		}),
		[],
	);

	const onDividerDown = useCallback(
		createDrag({
			onStart: () => {
				const startWidth = sidebarWidthRef.current;
				return ({ dx }) =>
					setSidebarWidth(Math.max(SIDEBAR_MIN, startWidth + dx));
			},
		}),
		[],
	);

	return {
		bubblePosition,
		panelPosition,
		size,
		sidebarWidth,
		onBubbleDown,
		onHeaderDown,
		onResizeDown,
		onDividerDown,
	};
}
