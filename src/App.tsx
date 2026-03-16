import { useState } from "react";
import { BasicChatPage } from "./examples/basic/BasicChatPage";
import { PersistentChatPage } from "./examples/with-persistence/PersistentChatPage";

type TExample = "basic" | "persistent";

const TABS: { key: TExample; label: string }[] = [
	{ key: "basic", label: "Basic" },
	{ key: "persistent", label: "With Persistence" },
];

export function App() {
	const [activeExample, setActiveExample] = useState<TExample>("basic");

	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100">
			<nav className="border-b border-zinc-800 bg-zinc-900">
				<div className="mx-auto flex max-w-2xl items-center gap-6 px-6 py-3">
					<span className="text-sm font-semibold text-zinc-400">
						react-socket examples
					</span>
					<div className="flex gap-1">
						{TABS.map((tab) => (
							<button
								key={tab.key}
								type="button"
								onClick={() => setActiveExample(tab.key)}
								className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
									activeExample === tab.key
										? "bg-indigo-600 text-white"
										: "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>
			</nav>

			{activeExample === "basic" && <BasicChatPage />}
			{activeExample === "persistent" && <PersistentChatPage />}
		</div>
	);
}
