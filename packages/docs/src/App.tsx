import type { WebSocketManager } from "@luciodale/react-socket";
import { InspectorPanel } from "@luciodale/react-socket/inspector";
import { useCallback, useState } from "react";
import {
	MinimalChatPage as MinimalPage,
	manager as minimalManager,
} from "./examples/minimal/MinimalChatPage";
import {
	MinimalChatPage as ReactQueryPage,
	manager as reactQueryManager,
} from "./examples/minimal-react-query/MinimalChatPage";
import {
	OpenAIRealtimePage,
	manager as openaiManager,
} from "./examples/openai-realtime/OpenAIRealtimePage";
import {
	UndeliveredSyncPage,
	manager as undeliveredManager,
} from "./examples/undelivered-sync/UndeliveredSyncPage";

type TTab = "minimal" | "react-query" | "undelivered-sync" | "openai-realtime";

const TABS: { key: TTab; label: string }[] = [
	{ key: "minimal", label: "Minimal" },
	{ key: "react-query", label: "React Query" },
	{ key: "undelivered-sync", label: "Undelivered Sync" },
	{ key: "openai-realtime", label: "OpenAI Realtime" },
];

// Each example has its own manager — pick the active one for the inspector
const MANAGERS: Record<
	TTab,
	// biome-ignore lint/suspicious/noExplicitAny: managers have different generic params
	WebSocketManager<any, any>
> = {
	minimal: minimalManager,
	"react-query": reactQueryManager,
	"undelivered-sync": undeliveredManager,
	"openai-realtime": openaiManager,
};

const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));

function readTabFromUrl(): TTab {
	const param = new URLSearchParams(window.location.search).get("tab");
	if (param && TAB_KEYS.has(param)) return param as TTab;
	return "minimal";
}

export function App() {
	const [activeTab, setActiveTabState] = useState<TTab>(readTabFromUrl);

	const setActiveTab = useCallback((tab: TTab) => {
		setActiveTabState(tab);
		const url = new URL(window.location.href);
		url.searchParams.set("tab", tab);
		window.history.replaceState(null, "", url.toString());
	}, []);

	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100">
			<nav className="border-b border-zinc-800 bg-zinc-900">
				<div className="mx-auto flex max-w-2xl items-center gap-1 px-6 py-2">
					{TABS.map((tab) => (
						<button
							key={tab.key}
							type="button"
							onClick={() => setActiveTab(tab.key)}
							className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
								activeTab === tab.key
									? "bg-indigo-600 text-white"
									: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
							}`}
						>
							{tab.label}
						</button>
					))}
				</div>
			</nav>

			{activeTab === "minimal" && <MinimalPage />}
			{activeTab === "react-query" && <ReactQueryPage />}
			{activeTab === "undelivered-sync" && <UndeliveredSyncPage />}
			{activeTab === "openai-realtime" && <OpenAIRealtimePage />}

			<InspectorPanel manager={MANAGERS[activeTab]} />
		</div>
	);
}
