import { useEffect, useRef, useState } from "react";
import type { TConnectionState } from "../types";
import { useConnectionStatus } from "./use-connection-status";

const STYLE_BASE: React.CSSProperties = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	padding: "8px 16px",
	textAlign: "center",
	fontSize: 14,
	fontWeight: 500,
	zIndex: 9999,
	transition: "transform 0.3s ease, opacity 0.3s ease",
};

const COLORS: Record<string, { bg: string; fg: string }> = {
	reconnecting: { bg: "#fef3c7", fg: "#92400e" },
	disconnected: { bg: "#fee2e2", fg: "#991b1b" },
	connected: { bg: "#d1fae5", fg: "#065f46" },
};

export function ConnectionStatus() {
	const status = useConnectionStatus();
	const visible = status.visible;
	const state: TConnectionState | null = status.visible ? status.state : null;
	const message = status.visible ? status.message : null;

	const [show, setShow] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}

		if (!visible) {
			setShow(false);
			return;
		}

		setShow(true);

		if (state === "connected") {
			timerRef.current = setTimeout(() => setShow(false), 3_000);
		}

		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [visible, state]);

	if (!visible || !state) return null;

	const colors = COLORS[state] ?? COLORS.disconnected;

	return (
		<div
			style={{
				...STYLE_BASE,
				backgroundColor: colors.bg,
				color: colors.fg,
				transform: show ? "translateY(0)" : "translateY(-100%)",
				opacity: show ? 1 : 0,
			}}
		>
			{message}
		</div>
	);
}
