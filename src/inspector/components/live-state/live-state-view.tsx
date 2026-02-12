import { ConnectionSection } from "./connection-section";
import { ErrorSection } from "./error-section";
import { MessagesSection } from "./messages-section";
import { OutgoingMessagesSection } from "./outgoing-messages-section";
import { QueueSection } from "./queue-section";
import { SubscriptionsSection } from "./subscriptions-section";

export function LiveStateView() {
	return (
		<div className="overflow-y-auto p-3 h-full">
			<ConnectionSection />
			<SubscriptionsSection />
			<MessagesSection />
			<OutgoingMessagesSection />
			<QueueSection />
			<ErrorSection />
		</div>
	);
}
