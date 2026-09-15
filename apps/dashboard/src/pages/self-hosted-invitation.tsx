import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RiErrorWarningFill, RiTeamLine } from 'react-icons/ri';
import { useNavigate, useParams } from 'react-router-dom';
import {
  acceptInvitation,
  getInvitation,
  loginForInvitation,
  openDashboardWith,
  registerForInvitation,
  SELF_HOSTED_JWT_KEY,
} from '@/api/team';
import { t } from '@/components/crm/crm-i18n';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import {
  SegmentedControl,
  SegmentedControlList,
  SegmentedControlTrigger,
} from '@/components/primitives/segmented-control';
import { Skeleton } from '@/components/primitives/skeleton';
import { isJwtValid } from '@/utils/self-hosted/jwt-manager';

// izipush — page publique d'une invitation (auto-hébergé communautaire) : la personne invitée crée son compte
// ou se connecte, puis rejoint l'organisation, sans passer par la création d'une organisation à elle.

type Mode = 'register' | 'login';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[#?!@$%^&*()-]).{8,64}$/;

const capitalize = (value?: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-label-sm text-text-strong">
        {label}
      </Label>
      {children}
      {hint && <p className="text-text-soft text-paragraph-xs">{hint}</p>}
    </div>
  );
}

export function SelfHostedInvitationPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { data: invitation, isLoading, isError } = useQuery({
    queryKey: ['selfHostedInvitation', token],
    queryFn: () => getInvitation(token),
    retry: false,
  });

  const currentSession = localStorage.getItem(SELF_HOSTED_JWT_KEY);
  const isSignedIn = isJwtValid(currentSession);

  const [mode, setMode] = useState<Mode>();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeMode: Mode = mode ?? (invitation?._userId ? 'login' : 'register');

  const join = async (getSession: () => Promise<string>) => {
    setError(undefined);
    setIsSubmitting(true);

    try {
      const session = await getSession();
      openDashboardWith(await acceptInvitation(token, session));
    } catch (caught) {
      setError((caught as Error).message);
      setIsSubmitting(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!invitation) return;

    if (activeMode === 'register') {
      if (!firstName.trim()) return setError(t('invite.firstNameRequired'));
      if (!PASSWORD_RULE.test(password)) return setError(t('invite.passwordInvalid'));

      return join(async () => {
        const { token: session } = await registerForInvitation({
          email: invitation.email,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          invitationToken: token,
        });

        return session;
      });
    }

    return join(async () => (await loginForInvitation(invitation.email, password)).token);
  };

  const inviterName = invitation
    ? `${capitalize(invitation.inviter.firstName)} ${capitalize(invitation.inviter.lastName)}`.trim()
    : '';

  return (
    <>
      <PageMeta title={t('invite.pageTitle')} />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pt-12">
        {isLoading ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <span className="text-text-soft text-paragraph-sm">{t('invite.loading')}</span>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError || !invitation ? (
          <div className="flex flex-col gap-3">
            <h1 className="text-text-strong text-[18px] font-medium">{t('invite.invalid.title')}</h1>
            <p className="text-text-sub text-paragraph-sm">{t('invite.invalid.text')}</p>
            <Button variant="secondary" mode="outline" size="xs" className="w-fit" onClick={() => navigate('/auth/sign-in')}>
              {t('invite.goToSignIn')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="bg-bg-weak flex size-10 items-center justify-center rounded-full">
                <RiTeamLine className="text-text-sub size-5" aria-hidden />
              </div>
              <h1 className="text-text-strong text-[20px] font-medium tracking-tight">
                {t('invite.title', { org: invitation.organization.name })}
              </h1>
              <p className="text-text-sub text-paragraph-sm">
                {t('invite.text', { inviter: inviterName || '—', org: invitation.organization.name })}
              </p>
            </div>

            {isSignedIn ? (
              <div className="flex flex-col gap-3">
                <p className="text-text-sub text-paragraph-sm">{t('invite.signedIn')}</p>
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={isSubmitting}
                  onClick={() => join(async () => currentSession as string)}
                >
                  {t('invite.join')}
                </Button>
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={submit}>
                <SegmentedControl value={activeMode} onValueChange={(value) => { setMode(value as Mode); setError(undefined); }}>
                  <SegmentedControlList className="bg-bg-muted w-full rounded-[5px] p-1" floatingBgClassName="rounded-[1px]">
                    <SegmentedControlTrigger value="register" className="text-label-xs flex-1">
                      {t('invite.tab.register')}
                    </SegmentedControlTrigger>
                    <SegmentedControlTrigger value="login" className="text-label-xs flex-1">
                      {t('invite.tab.login')}
                    </SegmentedControlTrigger>
                  </SegmentedControlList>
                </SegmentedControl>

                {activeMode === 'register' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="invite-first-name" label={t('invite.firstName')}>
                      <Input id="invite-first-name" value={firstName} autoComplete="given-name" onChange={(event) => setFirstName(event.target.value)} />
                    </Field>
                    <Field id="invite-last-name" label={t('invite.lastName')}>
                      <Input id="invite-last-name" value={lastName} autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} />
                    </Field>
                  </div>
                )}

                <Field id="invite-email" label={t('invite.email')} hint={t('invite.emailHint')}>
                  <Input id="invite-email" type="email" value={invitation.email} readOnly autoComplete="email" />
                </Field>

                <Field
                  id="invite-password"
                  label={t('invite.password')}
                  hint={activeMode === 'register' ? t('invite.passwordHint') : undefined}
                >
                  <Input
                    id="invite-password"
                    type="password"
                    value={password}
                    autoComplete={activeMode === 'register' ? 'new-password' : 'current-password'}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>

                {error && (
                  <p className="text-error-base text-paragraph-xs flex items-center gap-1" role="alert">
                    <RiErrorWarningFill className="size-3.5 shrink-0" aria-hidden />
                    {error}
                  </p>
                )}

                <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                  {activeMode === 'register' ? t('invite.submitRegister') : t('invite.submitLogin')}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </>
  );
}
