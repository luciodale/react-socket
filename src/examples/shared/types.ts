// ── Domain types ────────────────────────────────────────────────────

export type TContentBlock = { type: "text"; text: string };

export type TMessageStatus = "pending" | "sent" | "undelivered";

export type TChatMessage = {
	id: string;
	sender: string;
	content: TContentBlock[];
	status: TMessageStatus;
	undeliveredAt?: string;
};

// ── Store shape ─────────────────────────────────────────────────────

export type TChatState = {
	messages: Record<string, TChatMessage[]>;
};

// ── Server → Client ─────────────────────────────────────────────────

export type TServerMessage =
	| { action: "subscribe_ack"; type: string; channel: string }
	| { action: "unsubscribe_ack"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			delivery: "event";
			id: string;
			channel: string;
			sender: string;
			content: TContentBlock[];
	  }
	| {
			action: "message";
			type: "conversation";
			delivery: "dump";
			channel: string;
			messages: { id: string; sender: string; content: TContentBlock[] }[];
	  }
	| {
			action: "message";
			type: "conversation";
			delivery: "error";
			channel: string;
			error: string;
			message: string;
			messageId?: string;
	  }
	| { action: "error"; code: number; message: string; messageId?: string };

// ── Client → Server ─────────────────────────────────────────────────

export type TClientMessage =
	| { action: "subscribe"; type: string; channel: string }
	| { action: "unsubscribe"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			id: string;
			channel: string;
			message: string;
	  };
