import { useSocketStore } from "../../../socket/store";
import { Section } from "../shared/section";

const STATE_COLORS: Record<string, string> = {
	connected: "text-emerald-400",
	reconnecting: "text-amber-400",
	connecting: "text-amber-400",
	disconnected: "text-red-400",
};

export function ConnectionSection() {
	const connectionState = useSocketStore((s) => s.connectionState);
	const hasConnected = useSocketStore((s) => s.hasConnected);

	return (
		<Section title="Connection">
			<table className="text-xs">
				<tbody>
					<tr>
						<td className="pr-4 text-neutral-500">state</td>
						<td
							className={`font-bold ${STATE_COLORS[connectionState] ?? "text-neutral-300"}`}
						>
							{connectionState}
						</td>
					</tr>
					<tr>
						<td className="pr-4 text-neutral-500">hasConnected</td>
						<td>{String(hasConnected)}</td>
					</tr>
				</tbody>
			</table>
		</Section>
	);
}
