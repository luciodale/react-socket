const BASE_PATH = "/projects/react-socket";

export function getWsUrl() {
	if (import.meta.env.DEV) return "ws://localhost:3001/ws";
	if (typeof window === "undefined") return "";
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}${BASE_PATH}/api/ws`;
}
