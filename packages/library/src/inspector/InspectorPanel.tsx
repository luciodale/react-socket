import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WebSocketManager } from "../manager";
import { InspectorDiffView } from "./InspectorDiffView";
import { InspectorEventList } from "./InspectorEventList";
import { InspectorFilterDropdown } from "./InspectorFilterDropdown";
import { InspectorStateView } from "./InspectorStateView";
import { CloseIcon } from "./icons";
import inspectorCss from "./inspector.css?inline";
import type { TInspectorPosition } from "./inspector-types";
import { type TTab, useInspectorPanel } from "./use-inspector-panel";

type TInspectorPanelProps<TClientMsg, TServerMsg> = {
	manager: WebSocketManager<TClientMsg, TServerMsg>;
	maxSnapshots?: number;
	defaultPosition?: TInspectorPosition;
};

const TABS: { key: TTab; label: string }[] = [
	{ key: "state", label: "State" },
	{ key: "diff", label: "Diff" },
];

export function InspectorPanel<TClientMsg, TServerMsg>({
	manager,
	maxSnapshots = 500,
	defaultPosition = "bottom-right",
}: TInspectorPanelProps<TClientMsg, TServerMsg>) {
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const panel = useInspectorPanel(manager, maxSnapshots, defaultPosition);

	useEffect(() => {
		const div = document.createElement("div");
		div.id = "react-socket-inspector";
		document.body.appendChild(div);

		const style = document.createElement("style");
		style.setAttribute("data-rsi", "");
		style.textContent = inspectorCss;
		document.head.appendChild(style);

		setContainer(div);
		return () => {
			document.body.removeChild(div);
			document.head.removeChild(style);
		};
	}, []);

	if (!container) return null;

	if (!panel.open) {
		return createPortal(
			// biome-ignore lint/a11y/useSemanticElements: drag+click composite handler
			<div
				role="button"
				tabIndex={0}
				className="rsi-root rsi-bubble"
				style={{ left: panel.bubblePosition.x, top: panel.bubblePosition.y }}
				onMouseDown={panel.onBubbleDown}
			>
				<span
					className="rsi-connection-dot"
					data-state={panel.connectionState}
				/>
				<span className="rsi-bubble-label">WS</span>
			</div>,
			container,
		);
	}

	return createPortal(
		<div
			className="rsi-root rsi-panel"
			style={{
				left: panel.panelPosition.x,
				top: panel.panelPosition.y,
				width: panel.size.width,
				height: panel.size.height,
			}}
		>
			{/* Header */}
			<div
				role="toolbar"
				className="rsi-header"
				onMouseDown={panel.onHeaderDown}
			>
				<div className="rsi-header-title">
					<span
						className="rsi-connection-dot"
						data-state={panel.connectionState}
					/>
					WS Inspector
				</div>
				<div className="rsi-header-controls">
					<button type="button" className="rsi-btn" onClick={panel.clear}>
						Clear
					</button>
					<button
						type="button"
						className="rsi-btn-icon"
						onClick={panel.handleClose}
					>
						<CloseIcon />
					</button>
				</div>
			</div>

			{/* Body */}
			<div className="rsi-body">
				{/* Sidebar: event timeline */}
				<div className="rsi-sidebar" style={{ width: panel.sidebarWidth }}>
					<div className="rsi-sidebar-toolbar">
						<InspectorFilterDropdown
							eventTypes={panel.eventTypes}
							activeFilters={panel.activeFilters}
							toggleFilter={panel.toggleFilter}
							clearFilters={panel.clearFilters}
						/>
					</div>

					<InspectorEventList
						snapshots={panel.filtered}
						selectedSnapshotId={panel.selectedSnapshotId}
						onSelect={panel.goTo}
					/>
				</div>

				{/* Divider */}
				{/* biome-ignore lint/a11y/useSemanticElements: pane resize divider */}
				{/* biome-ignore lint/a11y/useFocusableInteractive: mouse-only resize */}
				<div
					role="separator"
					aria-valuenow={panel.sidebarWidth}
					className="rsi-divider"
					onMouseDown={panel.onDividerDown}
				/>

				{/* Main: state / diff */}
				<div className="rsi-main">
					<div className="rsi-tab-bar">
						{TABS.map((tab) => (
							<button
								key={tab.key}
								type="button"
								className="rsi-tab"
								data-active={panel.activeTab === tab.key}
								onClick={() => panel.setActiveTab(tab.key)}
							>
								{tab.label}
							</button>
						))}
					</div>

					{panel.activeTab === "state" && panel.currentState && (
						<InspectorStateView
							state={panel.currentState}
							isLive={panel.isLive}
						/>
					)}
					{panel.activeTab === "state" && !panel.currentState && (
						<div className="rsi-empty">No events captured yet</div>
					)}
					{panel.activeTab === "diff" && (
						<InspectorDiffView diff={panel.diff} />
					)}
				</div>
			</div>

			{/* Footer */}
			<div className="rsi-footer">
				<span className="rsi-footer-info">
					{panel.snapshots.length} events
					{!panel.isLive && panel.selectedSnapshotId !== null && (
						<> &middot; #{panel.selectedSnapshotId}</>
					)}
				</span>
				<button
					type="button"
					className="rsi-live-btn"
					data-active={panel.isLive}
					onClick={panel.goToLive}
				>
					<span className="rsi-live-dot" />
					Live
				</button>
			</div>

			{/* Resize handle */}
			{/* biome-ignore lint/a11y/useSemanticElements: resize drag handle */}
			<div
				role="separator"
				aria-valuenow={panel.size.height}
				tabIndex={0}
				className="rsi-resize-handle"
				onMouseDown={panel.onResizeDown}
			/>
		</div>,
		container,
	);
}
