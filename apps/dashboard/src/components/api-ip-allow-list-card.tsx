import { PermissionsEnum } from '@novu/shared';
import { useEffect, useState } from 'react';
import { RiInformationLine } from 'react-icons/ri';

import { Card, CardContent, CardHeader } from '@/components/primitives/card';
import { Skeleton } from '@/components/primitives/skeleton';
import { useFetchApiIpAllowList, useUpdateApiIpAllowList } from '@/hooks/use-api-ip-allow-list';
import { useHasPermission } from '@/hooks/use-has-permission';
import { Button } from './primitives/button';
import { showErrorToast, showSuccessToast } from './primitives/sonner-helpers';

/**
 * Une entrée par ligne : c'est la forme qu'on relit le mieux, et celle qu'on colle depuis
 * une console cloud sans la retoucher. Les virgules sont acceptées malgré tout, parce
 * qu'on les écrit par réflexe.
 */
function depuisTexte(texte: string): string[] {
  return [...new Set(texte.split(/[\n,]/).map((entree) => entree.trim()).filter(Boolean))];
}

/** Même grammaire que côté serveur — adresse seule ou CIDR, IPv4 comme IPv6. */
function entreeMalFormee(entree: string): boolean {
  const [adresse, prefixe, ...reste] = entree.split('/');
  if (reste.length > 0) return true;

  const estIpv6 = adresse.includes(':');
  const bits = estIpv6 ? 128 : 32;
  if (prefixe !== undefined && (!/^\d{1,3}$/.test(prefixe) || Number(prefixe) > bits)) return true;

  if (estIpv6) return !/^[0-9a-f:]+$/i.test(adresse) || (adresse.match(/::/g) ?? []).length > 1;

  const morceaux = adresse.split('.');

  return morceaux.length !== 4 || morceaux.some((m) => !/^(0|[1-9]\d{0,2})$/.test(m) || Number(m) > 255);
}

export function ApiIpAllowListCard() {
  const has = useHasPermission();
  const peutModifier = has({ permission: PermissionsEnum.API_KEY_WRITE });

  const { data, isLoading } = useFetchApiIpAllowList();
  const mutation = useUpdateApiIpAllowList();

  const [texte, setTexte] = useState('');
  const [initial, setInitial] = useState('');

  // La valeur arrive après coup : on ne l'écrase que lorsqu'elle change côté serveur,
  // pour ne pas effacer une saisie en cours à chaque réaffichage.
  useEffect(() => {
    if (!data) return;
    const charge = (data.data.ipAllowList ?? []).join('\n');
    setTexte(charge);
    setInitial(charge);
  }, [data]);

  const entrees = depuisTexte(texte);
  const fautives = entrees.filter(entreeMalFormee);
  const modifie = texte.trim() !== initial.trim();

  const enregistrer = async () => {
    try {
      await mutation.mutateAsync(entrees);
      setInitial(entrees.join('\n'));
      showSuccessToast(
        entrees.length === 0
          ? 'Restriction removed — API keys can be used from any address.'
          : 'IP allow list saved. It takes up to a minute to apply.'
      );
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Could not save the IP allow list');
    }
  };

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <CardHeader>
        IP allow list
        <p className="text-foreground-500 mt-1 text-xs font-normal">
          Restrict which addresses may use this environment&apos;s secret keys. One entry per line, plain or CIDR —
          e.g. <span className="font-mono">203.0.113.7</span> or <span className="font-mono">198.51.100.0/24</span>.
        </p>
      </CardHeader>
      <CardContent className="rounded-b-xl border-t bg-neutral-50 bg-white p-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-3">
            <textarea
              className="border-neutral-alpha-200 focus:border-neutral-alpha-300 min-h-24 w-full rounded-lg border bg-white p-3 font-mono text-xs outline-none disabled:opacity-60"
              placeholder={'Empty — no restriction\n203.0.113.7\n198.51.100.0/24'}
              value={texte}
              disabled={!peutModifier || mutation.isPending}
              onChange={(event) => setTexte(event.target.value)}
              spellCheck={false}
            />

            {/*
              Les trois points qui évitent un appel au support. Le premier surtout : une
              liste vide est le défaut, et il faut dire qu'elle n'interdit rien plutôt que
              de laisser deviner.
            */}
            <ul className="text-foreground-400 space-y-1 text-xs">
              <li className="flex items-start gap-1.5">
                <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
                An empty list places no restriction — this is the default.
              </li>
              <li className="flex items-start gap-1.5">
                <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
                Applies only to secret-key calls. Device endpoints and this dashboard are unaffected, so a wrong entry
                cannot lock you out.
              </li>
              <li className="flex items-start gap-1.5">
                <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
                Changes take up to a minute to apply.
              </li>
            </ul>

            {fautives.length > 0 && (
              <p className="text-destructive text-xs">
                Not an address or CIDR range: <span className="font-mono">{fautives.join(', ')}</span>
              </p>
            )}

            {peutModifier && (
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="secondary"
                  mode="outline"
                  disabled={!modifie || fautives.length > 0 || mutation.isPending}
                  isLoading={mutation.isPending}
                  onClick={enregistrer}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
