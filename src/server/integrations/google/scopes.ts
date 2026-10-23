export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Requested at connect time. Read-only: nothing here can write to a sheet or send mail. */
export const CONNECT_SCOPES = `${SHEETS_SCOPE} ${GMAIL_SCOPE}`;

export function hasScope(granted: string, scope: string): boolean {
  return granted.split(/\s+/).includes(scope);
}

/**
 * Decision for the connect callback. Pure so it can be tested: the session user after the code
 * exchange must be the same person who started the connect flow, and a household member.
 */
export type ConnectDecision = "ok" | "denied";
export function decideConnect(input: { before: string | null; after: string | null; isMember: boolean }): ConnectDecision {
  if (!input.before || !input.after) return "denied";
  if (input.before !== input.after) return "denied";
  return input.isMember ? "ok" : "denied";
}
