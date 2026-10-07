import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RiCheckLine, RiExpandUpDownLine } from 'react-icons/ri';
import { listMyOrganizations, openDashboardWith, switchOrganization } from '@/api/team';
import { t } from '@/components/crm/crm-i18n';
import { Avatar } from '@/components/primitives/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/primitives/dropdown-menu';
import { showErrorToast } from '@/components/primitives/sonner-helpers';
import { NovuLogoBlackBg } from './icons';
import { useOrganization } from './index';

// izipush — sélecteur d'organisation en auto-hébergé : un compte membre de plusieurs organisations peut en changer.

function OrganizationSwitcherComponent() {
  const { organization, isLoaded } = useOrganization() as {
    organization: { name: string; _id?: string } | undefined;
    isLoaded: boolean;
  };
  const { data: organizations = [] } = useQuery({
    queryKey: ['selfHostedOrganizations'],
    queryFn: listMyOrganizations,
    enabled: isLoaded && !!organization,
    staleTime: 60_000,
  });
  const [switching, setSwitching] = useState<string>();

  if (!isLoaded) {
    return (
      <div className="flex w-full items-center gap-2 px-1.5 py-1.5">
        <div className="size-6 animate-pulse rounded-full bg-neutral-alpha-100" />
        <div className="h-4 w-32 animate-pulse rounded bg-neutral-alpha-100" />
      </div>
    );
  }

  if (!organization) return null;

  const current = (
    <>
      <OrganizationAvatar shining={false} />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground-950">
        {organization.name}
      </span>
    </>
  );

  if (organizations.length <= 1) {
    return <div className="relative flex w-full items-center justify-start gap-2 rounded-lg px-1.5 py-1.5">{current}</div>;
  }

  const change = async (organizationId: string) => {
    if (organizationId === organization._id) return;
    setSwitching(organizationId);

    try {
      openDashboardWith(await switchOrganization(organizationId));
    } catch (error) {
      setSwitching(undefined);
      showErrorToast((error as Error).message, t('org.switchFailed'));
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('org.switch')}
          className="hover:bg-neutral-alpha-50 focus-visible:ring-stroke-strong relative flex w-full items-center justify-start gap-2 rounded-lg px-1.5 py-1.5 outline-none transition-colors focus-visible:ring-2"
        >
          {current}
          <RiExpandUpDownLine className="text-text-soft size-4 shrink-0" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <div className="text-text-soft text-label-xs px-2 py-1.5">{t('org.switch')}</div>
        {organizations.map((candidate) => (
          <DropdownMenuItem
            key={candidate._id}
            className="cursor-pointer"
            disabled={!!switching}
            onClick={() => change(candidate._id)}
          >
            <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
            {candidate._id === organization._id && <RiCheckLine className="text-primary-base size-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { OrganizationSwitcherComponent as OrganizationDropdown, OrganizationSwitcherComponent as OrganizationSwitcher };

const OrganizationAvatar = ({ shining = false }: { shining?: boolean }) => {
  return (
    <Avatar className="relative h-6 w-6 overflow-hidden border-gray-200">
      <NovuLogoBlackBg />
      {shining && (
        <div className="absolute inset-0 before:absolute before:-left-full before:top-0 before:h-full before:w-full before:bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.3),transparent)] before:transition-all before:duration-[10000ms] before:ease-in-out group-hover:before:left-full"></div>
      )}
    </Avatar>
  );
};
