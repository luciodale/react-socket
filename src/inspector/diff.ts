import type { TDiffEntry, TSocketStoreState } from "./types";

export function computeDiff(
	prev: TSocketStoreState,
	next: TSocketStoreState,
): TDiffEntry[] {
	const entries: TDiffEntry[] = [];
	diffRecursive(prev, next, "", entries);
	return entries;
}

function diffRecursive(
	a: unknown,
	b: unknown,
	path: string,
	entries: TDiffEntry[],
): void {
	if (a === b) return;

	// Both null/undefined
	if (a == null && b == null) return;

	// One side null/undefined
	if (a == null) {
		entries.push({ path, type: "added", newValue: b });
		return;
	}
	if (b == null) {
		entries.push({ path, type: "removed", oldValue: a });
		return;
	}

	// Primitives
	if (typeof a !== "object" || typeof b !== "object") {
		entries.push({ path, type: "changed", oldValue: a, newValue: b });
		return;
	}

	// Arrays — use JSON comparison (sufficient for dev tool)
	if (Array.isArray(a) || Array.isArray(b)) {
		if (JSON.stringify(a) !== JSON.stringify(b)) {
			entries.push({ path, type: "changed", oldValue: a, newValue: b });
		}
		return;
	}

	// Objects — recurse
	const aObj = a as Record<string, unknown>;
	const bObj = b as Record<string, unknown>;
	const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);

	for (const key of allKeys) {
		const childPath = path ? `${path}.${key}` : key;
		if (!(key in aObj)) {
			entries.push({ path: childPath, type: "added", newValue: bObj[key] });
		} else if (!(key in bObj)) {
			entries.push({
				path: childPath,
				type: "removed",
				oldValue: aObj[key],
			});
		} else {
			diffRecursive(aObj[key], bObj[key], childPath, entries);
		}
	}
}
