// Mock authentication hook
// In a real app, this would come from your auth provider (Auth0, Clerk, etc.)

type TAuthResult = {
	token: string;
};

export function useAuth(): TAuthResult {
	return { token: "eyJhbGciOiJIUzI1NiJ9.demo-user-token" };
}
