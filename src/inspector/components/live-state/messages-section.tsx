import { useSocketStore } from "../../../socket/store";
import { useInFlightMessages } from "../../hooks/use-in-flight-messages";
import { JsonViewer } from "../shared/json-viewer";
import { Section } from "../shared/section";

export function MessagesSection() {
	const conversationMessages = useSocketStore((s) => s.conversationMessages);
	const notificationMessages = useSocketStore((s) => s.notificationMessages);
	const inFlightMessages = useInFlightMessages();

	const convChannels = Object.keys(conversationMessages);
	const notifChannels = Object.keys(notificationMessages);
	const totalConv = Object.values(conversationMessages).reduce(
		(sum, msgs) => sum + msgs.length,
		0,
	);
	const totalNotif = Object.values(notificationMessages).reduce(
		(sum, msgs) => sum + msgs.length,
		0,
	);

	return (
		<>
			<Section
				title={`Conversations (${totalConv} across ${convChannels.length} ch)`}
			>
				{convChannels.length === 0 ? (
					<p className="m-0 text-neutral-600">No messages in store</p>
				) : (
					convChannels.map((channel) => (
						<Section
							key={channel}
							title={`#${channel} (${conversationMessages[channel].length})`}
							defaultOpen={false}
						>
							<JsonViewer data={conversationMessages[channel]} />
						</Section>
					))
				)}
			</Section>

			<Section
				title={`Notifications (${totalNotif} across ${notifChannels.length} ch)`}
			>
				{notifChannels.length === 0 ? (
					<p className="m-0 text-neutral-600">No notifications</p>
				) : (
					notifChannels.map((channel) => (
						<Section
							key={channel}
							title={`#${channel} (${notificationMessages[channel].length})`}
							defaultOpen={false}
						>
							<JsonViewer data={notificationMessages[channel]} />
						</Section>
					))
				)}
			</Section>

			<Section title={`In-Flight Messages (${inFlightMessages.length})`}>
				{inFlightMessages.length === 0 ? (
					<p className="m-0 text-neutral-600">
						No messages awaiting server ack
					</p>
				) : (
					<JsonViewer
						data={Object.fromEntries(
							inFlightMessages.map(([id, msg]) => [id, msg]),
						)}
					/>
				)}
			</Section>
		</>
	);
}
