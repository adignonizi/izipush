import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RiFileCopyLine, RiLinkM, RiLogoutBoxRLine, RiRefreshLine, RiUserAddLine } from 'react-icons/ri';
import {
  getTeamMembers,
  invitationLink,
  inviteTeamMember,
  removeTeamMember,
  renewTeamInvite,
  type TeamMember,
} from '@/api/team';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { formatDay, t } from '@/components/crm/crm-i18n';
import { CrmRowMenu, CrmSection } from '@/components/crm/crm-page';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { CompactButton } from '@/components/primitives/button-compact';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useOrganization } from './organization.resource';
import { useAuth } from './use-auth';

// izipush — onglet « Team » en auto-hébergé communautaire : l'édition n'envoie pas d'email d'invitation,
// on génère un lien que l'administrateur transmet lui-même.

const TEAM_QUERY_KEY = ['selfHostedTeamMembers'];

const capitalize = (value?: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');

function memberName(member: TeamMember): string {
  if (!member.user) return member.invite?.email ?? '—';
  const name = `${capitalize(member.user.firstName)} ${capitalize(member.user.lastName)}`.trim();

  return name || member.user.email || '—';
}

async function copy(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    showSuccessToast(t('team.copied'));
  } catch {
    showErrorToast(link, t('team.toast.failed'));
  }
}

export function SelfHostedTeamMembers() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const { organization } = useOrganization() as { organization?: { name: string } };
  const orgName = organization?.name ?? '';

  const { data: members = [], isLoading } = useQuery({ queryKey: TEAM_QUERY_KEY, queryFn: getTeamMembers });
  const refresh = () => queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY });

  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<{ email: string; link: string }>();
  const [toRemove, setToRemove] = useState<TeamMember>();

  const invite = useMutation({
    mutationFn: inviteTeamMember,
    onSuccess: async (data, invitedEmail) => {
      const fresh = await queryClient.fetchQuery({ queryKey: TEAM_QUERY_KEY, queryFn: getTeamMembers });
      const token =
        data.token ?? fresh.find((member) => member.invite?.email === invitedEmail.trim().toLowerCase())?.invite?.token;
      if (token) setCreated({ email: invitedEmail, link: invitationLink(token) });
      setEmail('');
    },
    onError: (error) => showErrorToast((error as Error).message, t('team.toast.failed')),
  });

  const renew = useMutation({
    mutationFn: renewTeamInvite,
    onSuccess: async () => {
      await refresh();
      showSuccessToast(t('team.toast.newLink'));
    },
    onError: (error) => showErrorToast((error as Error).message, t('team.toast.failed')),
  });

  const remove = useMutation({
    mutationFn: removeTeamMember,
    onSuccess: async (_data, memberId) => {
      const member = members.find((candidate) => candidate._id === memberId);
      showSuccessToast(member?.memberStatus === 'invited' ? t('team.toast.cancelled') : t('team.toast.removed'));
      setToRemove(undefined);
      await refresh();
    },
    onError: (error) => showErrorToast((error as Error).message, t('team.toast.failed')),
  });

  const isPendingRemoval = toRemove?.memberStatus === 'invited';

  return (
    <div className="flex flex-col gap-8">
      <CrmSection title={t('team.title')} description={t('team.description', { org: orgName })}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) invite.mutate(email.trim());
          }}
        >
          <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">
            <Label htmlFor="team-invite-email" className="text-label-sm text-text-strong">
              {t('team.invite.label')}
            </Label>
            <Input
              id="team-invite-email"
              type="email"
              value={email}
              placeholder={t('team.invite.placeholder')}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" size="xs" leadingIcon={RiUserAddLine} isLoading={invite.isPending}>
            {t('team.invite.submit')}
          </Button>
        </form>

        {created && (
          <div className="bg-bg-weak flex flex-col gap-2 rounded-lg p-3" aria-live="polite">
            <p className="text-text-strong text-paragraph-sm">{t('team.invite.done', { email: created.email })}</p>
            <div className="flex items-center gap-2">
              <code className="border-stroke-soft bg-bg-white text-text-sub font-code text-code-xs min-w-0 flex-1 truncate rounded-md border px-2 py-1.5">
                {created.link}
              </code>
              <Button type="button" variant="secondary" mode="outline" size="xs" leadingIcon={RiFileCopyLine} onClick={() => copy(created.link)}>
                {t('team.copy')}
              </Button>
            </div>
            <p className="text-text-soft text-paragraph-xs">{t('team.invite.linkHint')}</p>
          </div>
        )}
      </CrmSection>

      <Table isLoading={isLoading} loadingRowsCount={3}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('team.col.member')}</TableHead>
            <TableHead>{t('team.col.status')}</TableHead>
            <TableHead>{t('team.col.since')}</TableHead>
            <TableHead className="w-1">
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const isMe = !!userId && (member._userId === userId || member.user?._id === userId);
            const isInvited = member.memberStatus === 'invited';
            const token = member.invite?.token;

            return (
              <TableRow key={member._id}>
                <TableCell>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-text-strong font-medium">
                      {memberName(member)}
                      {isMe && <span className="text-text-soft ml-1.5 font-normal">({t('team.you')})</span>}
                    </span>
                    <span className="text-text-soft text-paragraph-xs">{member.user?.email ?? member.invite?.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="lighter" color={isInvited ? 'orange' : 'green'} size="md">
                    {isInvited ? t('team.status.invited') : t('team.status.active')}
                  </Badge>
                </TableCell>
                <TableCell className="text-text-sub font-code text-code-xs whitespace-nowrap">
                  {formatDay(isInvited ? member.invite?.invitationDate : member.createdAt)}
                </TableCell>
                <TableCell className="w-1">
                  <div className="flex items-center justify-end gap-1">
                    {isInvited && token && (
                      <CompactButton
                        icon={RiLinkM}
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={t('team.copy')}
                        onClick={() => copy(invitationLink(token))}
                      />
                    )}
                    {!isMe && (
                      <CrmRowMenu
                        items={
                          isInvited
                            ? [
                                {
                                  label: t('team.action.newLink'),
                                  icon: RiRefreshLine,
                                  onSelect: () => renew.mutate(member._id),
                                },
                                {
                                  label: t('team.action.cancelInvite'),
                                  icon: RiLogoutBoxRLine,
                                  destructive: true,
                                  separatorBefore: true,
                                  onSelect: () => setToRemove(member),
                                },
                              ]
                            : [
                                {
                                  label: t('team.action.remove'),
                                  icon: RiLogoutBoxRLine,
                                  destructive: true,
                                  onSelect: () => setToRemove(member),
                                },
                              ]
                        }
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {!isLoading && members.length <= 1 && <p className="text-text-soft text-paragraph-sm">{t('team.empty')}</p>}

      <ConfirmationModal
        open={!!toRemove}
        onOpenChange={(open) => !open && setToRemove(undefined)}
        onConfirm={() => toRemove && remove.mutate(toRemove._id)}
        title={
          isPendingRemoval ? t('team.cancel.title') : t('team.remove.title', { name: toRemove ? memberName(toRemove) : '' })
        }
        description={
          isPendingRemoval
            ? t('team.cancel.text', { email: toRemove?.invite?.email ?? '' })
            : t('team.remove.text', { org: orgName })
        }
        confirmButtonText={isPendingRemoval ? t('team.action.cancelInvite') : t('team.action.remove')}
        confirmButtonVariant="error"
        isLoading={remove.isPending}
      />
    </div>
  );
}
