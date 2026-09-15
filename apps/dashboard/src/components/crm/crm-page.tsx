import type { ComponentProps, ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { RiArrowLeftSLine, RiMore2Fill } from 'react-icons/ri';
import { Link, useNavigate } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/primitives/breadcrumb';
import { CompactButton } from '@/components/primitives/button-compact';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/primitives/dropdown-menu';
import { HelpTooltipIndicator } from '@/components/primitives/help-tooltip-indicator';
import { Skeleton } from '@/components/primitives/skeleton';
import { TableCell } from '@/components/primitives/table';
import { cn } from '@/utils/ui';
import { t } from './crm-i18n';

// izipush-crm — briques de page communes aux écrans CRM, calquées sur les pages détaillées de Novu
// (fil d'Ariane, barre de titre, état vide, menu d'actions de ligne, pied de formulaire).

/** Contenu de `headerStartItems` : retour + fil d'Ariane, comme la page d'un domaine dans Novu. */
export function CrmBreadcrumbHeader({
  parentLabel,
  parentTo,
  current,
  icon: Icon,
  isLoading,
}: {
  parentLabel: string;
  parentTo: string;
  current?: string;
  icon?: IconType;
  isLoading?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      <CompactButton
        size="lg"
        className="mr-1 shrink-0"
        variant="ghost"
        icon={RiArrowLeftSLine}
        type="button"
        aria-label={t('common.back')}
        onClick={() => navigate(parentTo)}
      />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink to={parentTo}>{parentLabel}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            {isLoading ? (
              <Skeleton className="inline-block h-5 w-[16ch]" />
            ) : (
              <BreadcrumbPage className="flex min-w-0 items-center gap-1.5">
                {Icon && <Icon className="text-text-sub size-4 shrink-0" aria-hidden />}
                <span className="truncate">{current}</span>
              </BreadcrumbPage>
            )}
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}

/** Barre de titre sous l'en-tête d'une page détaillée. */
export function CrmTitleBar({
  title,
  badge,
  description,
  actions,
  isLoading,
}: {
  title?: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  isLoading?: boolean;
}) {
  return (
    <header className="border-stroke-soft border-b px-4 pb-3 pt-2 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="text-text-strong truncate text-[18px] font-medium leading-6 tracking-tight">{title}</h1>
              {badge}
            </div>
          )}
          {description && <p className="text-text-soft text-paragraph-sm max-w-[75ch]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Ligne au-dessus d'une liste : à quoi sert la page, et l'action principale. */
export function CrmListIntro({ description, action }: { description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <p className="text-text-soft text-paragraph-sm max-w-[75ch]">{description}</p>
      {action}
    </div>
  );
}

/** État vide qui explique l'écran plutôt que « rien ici ». */
export function CrmBlankState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: IconType;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[320px] w-full flex-col items-center justify-center gap-5 px-4 py-12 text-center">
      <div className="bg-bg-weak flex size-12 items-center justify-center rounded-full">
        <Icon className="text-text-soft size-6" aria-hidden />
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="text-text-sub text-label-md block font-medium">{title}</span>
        <p className="text-text-soft text-paragraph-sm max-w-[60ch]">{description}</p>
      </div>
      {action}
    </div>
  );
}

export type CrmRowMenuItem = {
  label: string;
  icon?: IconType;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
};

/** Menu « ⋯ » de fin de ligne, comme les listes de topics et de workflows. */
export function CrmRowMenu({ items, label }: { items: CrmRowMenuItem[]; label?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <CompactButton
          icon={RiMore2Fill}
          variant="ghost"
          className="z-10 h-8 w-8 p-0"
          aria-label={label ?? t('common.moreActions')}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52" align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuGroup>
          {items.map((item) => (
            <div key={item.label}>
              {item.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className={cn('cursor-pointer', item.destructive && 'text-destructive')}
                disabled={item.disabled}
                onClick={() => setTimeout(item.onSelect, 0)}
              >
                {item.icon && <item.icon className="size-4" aria-hidden />}
                {item.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Cellule dont toute la surface ouvre le détail (le lien au clavier est porté par la première cellule). */
export function CrmLinkedCell({ to, className, children, ...rest }: ComponentProps<typeof TableCell> & { to: string }) {
  return (
    <TableCell className={cn('group-hover:bg-neutral-alpha-50 text-text-sub relative', className)} {...rest}>
      <Link to={to} className="absolute inset-0" tabIndex={-1} aria-hidden>
        <span className="sr-only">{t('common.openDetails')}</span>
      </Link>
      {children}
    </TableCell>
  );
}

/** Titre de ligne focusable, qui ouvre le détail au clavier. */
export function CrmRowTitle({ to, title, subtitle }: { to: string; title: string; subtitle?: ReactNode }) {
  return (
    <div className="relative z-10 flex min-w-0 flex-col">
      <Link
        to={to}
        className="text-text-strong focus-visible:ring-stroke-strong truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2"
      >
        {title}
      </Link>
      {subtitle && <span className="text-text-soft text-paragraph-xs truncate">{subtitle}</span>}
    </div>
  );
}

/** Bloc de formulaire : titre, explication, contenu. */
export function CrmSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-text-strong text-label-md font-medium">{title}</h2>
        {description && <p className="text-text-soft text-paragraph-sm max-w-[65ch]">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Pied fixe d'une page de formulaire (même rôle que le pied des panneaux latéraux de Novu). */
export function CrmFormFooter({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-stroke-soft bg-bg-white sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t px-4 py-3 md:px-6">
      <p className="text-text-soft text-paragraph-xs">{hint}</p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Indicateur chiffré sobre, avec une aide au survol quand le chiffre demande une précision. */
export function CrmStat({
  label,
  value,
  hint,
  help,
  isLoading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  help?: string;
  isLoading?: boolean;
}) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-1">
      <span className="text-text-soft text-label-xs flex items-center gap-1 font-medium">
        {label}
        {help && <HelpTooltipIndicator text={help} size="3" />}
      </span>
      {isLoading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <span className="text-text-strong text-[22px] font-medium leading-7 tracking-tight tabular-nums">{value}</span>
      )}
      {hint && <span className="text-text-soft text-paragraph-xs">{hint}</span>}
    </div>
  );
}
