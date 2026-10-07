import { MemberSectionEnum } from '@novu/shared';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';
import { RiKey2Line, RiMegaphoneLine, RiPulseLine, RiRobot2Line, RiSettings3Line, RiUserLine } from 'react-icons/ri';

import { Button } from '@/components/primitives/button';
import { Checkbox } from '@/components/primitives/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/primitives/dialog';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { t } from '@/components/crm/crm-i18n';
import { CompactButton } from './primitives/button-compact';

/**
 * Les sections, dans l'ordre où elles apparaissent dans la navigation : la liste se lit comme
 * le menu, pour qu'on coche ce qu'on voit.
 */
const SECTIONS: Array<{ valeur: MemberSectionEnum; icone: typeof RiKey2Line; cle: string }> = [
  { valeur: MemberSectionEnum.AGENTS, icone: RiRobot2Line, cle: 'team.section.agents' },
  { valeur: MemberSectionEnum.NOTIFICATIONS, icone: RiMegaphoneLine, cle: 'team.section.notifications' },
  { valeur: MemberSectionEnum.DATA, icone: RiUserLine, cle: 'team.section.data' },
  { valeur: MemberSectionEnum.MONITOR, icone: RiPulseLine, cle: 'team.section.monitor' },
  { valeur: MemberSectionEnum.CRM, icone: RiSettings3Line, cle: 'team.section.crm' },
  { valeur: MemberSectionEnum.DEVELOPERS, icone: RiKey2Line, cle: 'team.section.developers' },
];

const TOUTES = SECTIONS.map((section) => section.valeur);

export type MemberAccessSubmit = { email: string; sections: MemberSectionEnum[] };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent : on invite. Présent : on modifie les accès de ce membre. */
  membre?: { nom: string; sections?: MemberSectionEnum[] };
  isLoading?: boolean;
  onSubmit: (valeurs: MemberAccessSubmit) => void;
};

export function MemberAccessDialog({ open, onOpenChange, membre, isLoading, onSubmit }: Props) {
  const modeEdition = !!membre;

  const [email, setEmail] = useState('');
  const [choisies, setChoisies] = useState<MemberSectionEnum[]>(TOUTES);

  /*
   * À l'ouverture, on repart de l'état réel. Un membre sans sections a accès à TOUT — on
   * affiche donc toutes les cases cochées, ce qui est la vérité, plutôt qu'aucune, ce qui
   * ferait croire qu'il n'a rien.
   */
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setChoisies(membre?.sections?.length ? membre.sections : TOUTES);
  }, [open, membre]);

  const basculer = (valeur: MemberSectionEnum) =>
    setChoisies((actuelles) =>
      actuelles.includes(valeur) ? actuelles.filter((item) => item !== valeur) : [...actuelles, valeur]
    );

  const toutesCochees = choisies.length === TOUTES.length;

  /*
   * Tout cocher et ne rien restreindre sont la même chose côté serveur : on envoie donc un
   * tableau vide, qui est la façon de dire « aucune restriction ». Envoyer les six valeurs
   * fonctionnerait aussi, mais figerait la liste — une section ajoutée plus tard ne serait pas
   * accordée à ce membre, sans que personne ne comprenne pourquoi.
   */
  const aEnvoyer = toutesCochees ? [] : choisies;

  const emailManquant = !modeEdition && !email.trim();
  const rienDeCoche = choisies.length === 0;

  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-[480px] gap-4 rounded-xl! p-4" hideCloseButton>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-label-lg">
                {modeEdition ? t('team.access.editTitle', { name: membre.nom }) : t('team.access.inviteTitle')}
              </DialogTitle>
              <DialogDescription className="text-text-soft text-paragraph-xs">
                {t('team.access.description')}
              </DialogDescription>
            </div>
            <CompactButton icon={Cross2Icon} variant="ghost" onClick={() => onOpenChange(false)} aria-label="Close" />
          </div>

          {!modeEdition && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-access-email" className="text-label-sm text-text-strong">
                {t('team.invite.label')}
              </Label>
              <Input
                id="member-access-email"
                type="email"
                value={email}
                placeholder={t('team.invite.placeholder')}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-label-sm text-text-strong">{t('team.access.sections')}</Label>
              <button
                type="button"
                className="text-text-soft hover:text-text-strong text-paragraph-xs underline"
                onClick={() => setChoisies(toutesCochees ? [] : TOUTES)}
              >
                {toutesCochees ? t('team.access.none') : t('team.access.all')}
              </button>
            </div>

            <div className="border-stroke-soft flex flex-col gap-0.5 rounded-lg border p-1">
              {SECTIONS.map(({ valeur, icone: Icone, cle }) => (
                <label
                  key={valeur}
                  className="hover:bg-bg-weak flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5"
                >
                  <Checkbox checked={choisies.includes(valeur)} onCheckedChange={() => basculer(valeur)} />
                  <Icone className="text-text-soft size-4 shrink-0" />
                  <span className="text-text-strong text-paragraph-sm">{t(cle)}</span>
                </label>
              ))}
            </div>

            {toutesCochees && <p className="text-text-soft text-paragraph-xs">{t('team.access.allHint')}</p>}
            {rienDeCoche && <p className="text-warning-base text-paragraph-xs">{t('team.access.noneHint')}</p>}
            {modeEdition && <p className="text-text-soft text-paragraph-xs">{t('team.access.delayHint')}</p>}
          </div>

          <DialogFooter>
            <Button variant="secondary" mode="outline" size="xs" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="xs"
              isLoading={isLoading}
              disabled={emailManquant || rienDeCoche || isLoading}
              onClick={() => onSubmit({ email: email.trim(), sections: aEnvoyer })}
            >
              {modeEdition ? t('team.access.save') : t('team.invite.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
