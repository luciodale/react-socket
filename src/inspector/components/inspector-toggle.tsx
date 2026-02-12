import { useInspectorStore } from "../inspector-store";

export function InspectorToggle() {
	const panelOpen = useInspectorStore((s) => s.panelOpen);
	const togglePanel = useInspectorStore((s) => s.togglePanel);

	if (panelOpen) return null;

	return (
		<button
			type="button"
			onClick={togglePanel}
			className="fixed bottom-4 right-4 z-[10000] flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-neutral-300 shadow-lg hover:bg-neutral-700 border border-neutral-700 text-sm"
			title="Open Socket Inspector"
		>
			🔌
		</button>
	);
}
