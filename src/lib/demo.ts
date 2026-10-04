/**
 * Local demo mode, for recording a walkthrough without signing in. It is on only when ALL of these hold:
 *   - a development build (`import.meta.env.DEV`; false in every production build, so this code is removed there),
 *   - started with `npm run demo` (Vite mode "demo"; Lovable's preview and `npm run dev` use other modes),
 *   - opened on localhost.
 * It only skips the client-side redirect to the sign-in page. Server functions that need an account still demand a
 * real session, and the pages shown read the same public sample data anyone can already read.
 */
export const DEMO: boolean =
  import.meta.env.DEV === true && import.meta.env.MODE === "demo" &&
  typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

export const DEMO_USER = { id: "00000000-0000-4000-8000-00000000d3m0", email: "demo@localhost", created_at: "2026-10-01T00:00:00Z", app_metadata: { provider: "demo", providers: ["demo"] } };
