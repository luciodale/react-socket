import { useSocketStore } from "../../../socket/store";
import { usePendingSubscriptions } from "../../hooks/use-pending-subscriptions";
import { Section } from "../shared/section";

export function SubscriptionsSection() {
	const refCounts = useSocketStore((s) => s.subscriptionRefCounts);
	const pending = usePendingSubscriptions();
	const keys = Object.keys(refCounts);

	return (
		<>
			<Section title={`Subscriptions (${keys.length})`}>
				{keys.length === 0 ? (
					<p className="m-0 text-neutral-600">No active subscriptions</p>
				) : (
					<table className="w-full text-xs">
						<thead>
							<tr className="text-neutral-500">
								<th className="text-left pr-4">key</th>
								<th className="text-right">refs</th>
							</tr>
						</thead>
						<tbody>
							{keys.map((key) => (
								<tr key={key}>
									<td className="pr-4">{key}</td>
									<td
										className={`text-right font-bold ${
											refCounts[key] > 1
												? "text-amber-400"
												: "text-emerald-400"
										}`}
									>
										{refCounts[key]}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Section>

			<Section title={`Pending Subscriptions (${pending.length})`}>
				{pending.length === 0 ? (
					<p className="m-0 text-neutral-600">No pending subscribe acks</p>
				) : (
					<ul className="m-0 list-disc pl-4">
						{pending.map((key) => (
							<li key={key} className="text-amber-400">
								{key}
							</li>
						))}
					</ul>
				)}
			</Section>
		</>
	);
}
