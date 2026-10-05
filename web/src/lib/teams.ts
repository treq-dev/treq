// The dashboard's side of organizations and Team (prds/billing-and-teams.md,
// "Organizations and seats"). The organizations Edge Function and the SQL
// behind it enforce every rule. These helpers only read invite links and
// count seats for display.

/** A Team covers this many members, counting pending invites. */
export const TEAM_SEAT_LIMIT = 10;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** The invite token in a dashboard URL's query string, if it has one. */
export function inviteTokenFromSearch(search: string): string | null {
  const token = new URLSearchParams(search).get("invite");
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/** The invite token in a pasted invite link, or a pasted bare token. */
export function inviteTokenFromInput(value: string): string | null {
  const trimmed = value.trim();
  const bare = trimmed.toLowerCase();
  if (TOKEN_PATTERN.test(bare)) return bare;
  try {
    return inviteTokenFromSearch(new URL(trimmed).search);
  } catch {
    return null;
  }
}

export function seatsUsed(counts: { members: number; pendingInvites: number }): number {
  return counts.members + counts.pendingInvites;
}

export type OrganizationAction =
  | { action: "create"; name: string }
  | { action: "invite"; organization_id: string; email: string }
  | { action: "accept"; token: string }
  | { action: "revoke_invite"; invite_id: string }
  | { action: "remove_member"; organization_id: string; user_id: string }
  | { action: "leave"; organization_id: string }
  | { action: "attach_installation"; organization_id: string; installation_id: number };
