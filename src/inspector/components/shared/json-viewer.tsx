import { useState } from "react";

type TJsonViewerProps = {
	data: unknown;
	label?: string;
	defaultExpanded?: boolean;
};

export function JsonViewer({
	data,
	label,
	defaultExpanded = false,
}: TJsonViewerProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	if (data === null || data === undefined) {
		return (
			<span className="text-neutral-500">
				{label && <span className="text-neutral-400">{label}: </span>}
				{String(data)}
			</span>
		);
	}

	if (typeof data !== "object") {
		return (
			<span>
				{label && <span className="text-neutral-400">{label}: </span>}
				<span className={valueColor(data)}>{formatPrimitive(data)}</span>
			</span>
		);
	}

	const isArray = Array.isArray(data);
	const entries = isArray
		? (data as unknown[]).map((v, i) => [String(i), v] as const)
		: (Object.entries(data as Record<string, unknown>));
	const isEmpty = entries.length === 0;

	if (isEmpty) {
		return (
			<span className="text-neutral-500">
				{label && <span className="text-neutral-400">{label}: </span>}
				{isArray ? "[]" : "{}"}
			</span>
		);
	}

	return (
		<div className="leading-relaxed">
			<button
				type="button"
				onClick={() => setExpanded((e) => !e)}
				className="text-neutral-400 hover:text-neutral-200"
			>
				<span className="text-[10px]">{expanded ? "▼" : "▶"}</span>{" "}
				{label && <span className="text-neutral-400">{label}: </span>}
				{!expanded && (
					<span className="text-neutral-500">
						{isArray
							? `[${entries.length}]`
							: `{${entries.length}}`}
					</span>
				)}
			</button>
			{expanded && (
				<div className="border-l border-neutral-800 pl-3 ml-1">
					{entries.map(([key, value]) => (
						<div key={key}>
							<JsonViewer data={value} label={key} />
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function formatPrimitive(value: unknown): string {
	if (typeof value === "string") return `"${value}"`;
	return String(value);
}

function valueColor(value: unknown): string {
	if (typeof value === "string") return "text-emerald-400";
	if (typeof value === "number") return "text-sky-400";
	if (typeof value === "boolean") return "text-amber-400";
	return "text-neutral-300";
}
