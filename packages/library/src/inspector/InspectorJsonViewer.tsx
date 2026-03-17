import { useState } from "react";

type TInspectorJsonViewerProps = {
	data: unknown;
	depth?: number;
};

function isExpandable(
	value: unknown,
): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === "object";
}

export function InspectorJsonViewer({
	data,
	depth = 0,
}: TInspectorJsonViewerProps) {
	const [expanded, setExpanded] = useState(depth < 2);

	if (data === null) {
		return <span className="rsi-json-null">null</span>;
	}

	if (data === undefined) {
		return <span className="rsi-json-null">undefined</span>;
	}

	if (typeof data === "string") {
		return <span className="rsi-json-string">&quot;{data}&quot;</span>;
	}

	if (typeof data === "number" || typeof data === "bigint") {
		return <span className="rsi-json-number">{String(data)}</span>;
	}

	if (typeof data === "boolean") {
		return <span className="rsi-json-boolean">{data ? "true" : "false"}</span>;
	}

	if (!isExpandable(data)) {
		return <span>{String(data)}</span>;
	}

	const isArray = Array.isArray(data);
	const entries = isArray
		? data.map((v, i) => [String(i), v] as const)
		: Object.entries(data);

	const openBracket = isArray ? "[" : "{";
	const closeBracket = isArray ? "]" : "}";

	if (entries.length === 0) {
		return (
			<span className="rsi-json-bracket">
				{openBracket}
				{closeBracket}
			</span>
		);
	}

	function handleToggle() {
		setExpanded((prev) => !prev);
	}

	if (!expanded) {
		return (
			<span>
				<button
					type="button"
					onClick={handleToggle}
					className="rsi-json-toggle"
				>
					{openBracket} {"\u2026"} {entries.length} items {closeBracket}
				</button>
			</span>
		);
	}

	return (
		<span>
			<button type="button" onClick={handleToggle} className="rsi-json-toggle">
				{openBracket}
			</button>
			<div className="rsi-json-nested">
				{entries.map(([key, value]) => (
					<div key={key} className="rsi-json-entry">
						<span className="rsi-json-key">{key}</span>
						<span className="rsi-json-bracket">: </span>
						<InspectorJsonViewer data={value} depth={depth + 1} />
					</div>
				))}
			</div>
			<span className="rsi-json-bracket">{closeBracket}</span>
		</span>
	);
}
