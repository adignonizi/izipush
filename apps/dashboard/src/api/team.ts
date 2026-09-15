import { API_HOSTNAME } from '@/config';
import { del, get, post } from './api.client';

// izipush — équipe en auto-hébergé communautaire : membres, invitations par lien, changement d'organisation.
// Les routes existent déjà dans l'API Novu (/v1/organizations/members, /v1/invites, /v1/auth/organizations/:id/switch).

export const SELF_HOSTED_JWT_KEY = 'self-hosted-jwt';

export type TeamMember = {
  _id: string;
  _userId?: string | null;
  user?: { _id: string; firstName?: string; lastName?: string; email?: string } | null;
  roles: string[];
  memberStatus: 'active' | 'invited';
  invite?: { email: string; token?: string; invitationDate?: string };
  createdAt?: string;
};

export type MyOrganization = { _id: string; name: string };

export type InvitationInfo = {
  inviter: { firstName?: string; lastName?: string };
  organization: { _id: string; name: string };
  email: string;
  _userId?: string;
};

export function invitationLink(token: string): string {
  return `${window.location.origin}/auth/invitation/${token}`;
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  return (await get<{ data: TeamMember[] }>('/organizations/members')).data;
}

export async function inviteTeamMember(email: string): Promise<{ token?: string }> {
  return (await post<{ data: { success: boolean; token?: string } }>('/invites', { body: { email } })).data;
}

/** Remplace le jeton de l'invitation : l'ancien lien ne fonctionne plus. */
export async function renewTeamInvite(memberId: string): Promise<void> {
  await post('/invites/resend', { body: { memberId } });
}

export async function removeTeamMember(memberId: string): Promise<void> {
  await del(`/organizations/members/${memberId}`);
}

export async function listMyOrganizations(): Promise<MyOrganization[]> {
  return (await get<{ data: MyOrganization[] }>('/organizations')).data;
}

export async function switchOrganization(organizationId: string): Promise<string> {
  return (await post<{ data: string }>(`/auth/organizations/${organizationId}/switch`, {})).data;
}

/** Appels hors session (page d'invitation) : l'utilisateur n'a pas encore de jeton, ou vient d'en recevoir un. */
async function publicRequest<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const response = await fetch(`${API_HOSTNAME}/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = json?.errors?.general?.messages?.[0] ?? json?.message;
    throw new Error(Array.isArray(message) ? message.join(', ') : (message ?? `HTTP ${response.status}`));
  }

  return json.data as T;
}

export function getInvitation(token: string): Promise<InvitationInfo> {
  return publicRequest<InvitationInfo>(`/invites/${token}`);
}

/** Rejoint l'organisation ; renvoie le jeton de session de cette organisation. */
export function acceptInvitation(inviteToken: string, sessionToken: string): Promise<string> {
  return publicRequest<string>(`/invites/${inviteToken}/accept`, { method: 'POST', token: sessionToken });
}

export function registerForInvitation(body: {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
  invitationToken: string;
}): Promise<{ token: string }> {
  return publicRequest<{ token: string }>('/auth/register', { method: 'POST', body });
}

export function loginForInvitation(email: string, password: string): Promise<{ token: string }> {
  return publicRequest<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } });
}

/** Ouvre le dashboard avec un nouveau jeton (organisation rejointe ou changée) : rechargement complet. */
export function openDashboardWith(sessionToken: string): void {
  localStorage.setItem(SELF_HOSTED_JWT_KEY, sessionToken);
  window.location.assign('/');
}
