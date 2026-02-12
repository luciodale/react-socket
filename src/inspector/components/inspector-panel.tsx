import { useCallback, useRef } from "react";
import { useInspectorStore } from "../inspector-store";
import { LiveStateView } from "./live-state/live-state-view";
import { ModeTabs } from "./mode-tabs";
import { TimeMachineView } from "./time-machine/time-machine-view";

export function InspectorPanel() {
	const panelOpen = useInspectorStore((s) => s.panelOpen);
	const mode = useInspectorStore((s) => s.mode);
	const togglePanel = useInspectorStore((s) => s.togglePanel);
	const panelHeight = useInspectorStore((s) => s.panelHeight);
	const setPanelHeight = useInspectorStore((s) => s.setPanelHeight);

	const dragging = useRef(false);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			dragging.current = true;
			const target = e.currentTarget as HTMLElement;
			target.setPointerCapture(e.pointerId);

			function onMove(ev: PointerEvent) {
				if (!dragging.current) return;
				const newHeight = window.innerHeight - ev.clientY;
				setPanelHeight(newHeight);
			}

			function onUp() {
				dragging.current = false;
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
			}

			document.addEventListener("pointermove", onMove);
			document.addEventListener("pointerup", onUp);
		},
		[setPanelHeight],
	);

	if (!panelOpen) return null;

	return (
		<div
			style={{ height: panelHeight }}
			className="fixed bottom-0 inset-x-0 z-[9999] flex flex-col bg-neutral-950 font-mono text-xs text-neutral-300 text-left border-t border-neutral-800 shadow-2xl"
		>
			{/* Resize handle */}
			<div
				onPointerDown={handlePointerDown}
				className="absolute inset-x-0 -top-1.5 h-3 cursor-ns-resize group flex items-center justify-center"
			>
				<div className="h-0.5 w-10 rounded-full bg-neutral-700 group-hover:bg-neutral-500" />
			</div>

			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-950">
				<span className="text-[11px] font-bold text-neutral-300">
					Socket Inspector
				</span>
				<button
					type="button"
					onClick={togglePanel}
					className="text-neutral-500 hover:text-neutral-300 text-sm leading-none"
				>
					✕
				</button>
			</div>

			<ModeTabs />

			{/* Content */}
			<div className="flex-1 min-h-0">
				{mode === "live" ? <LiveStateView /> : <TimeMachineView />}
			</div>
		</div>
	);
}
