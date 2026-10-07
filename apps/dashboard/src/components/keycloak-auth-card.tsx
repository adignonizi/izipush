import { PermissionsEnum } from '@novu/shared';
import { useEffect, useState } from 'react';
import { RiInformationLine } from 'react-icons/ri';

import { Card, CardContent, CardHeader } from '@/components/primitives/card';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { Skeleton } from '@/components/primitives/skeleton';
import { useFetchKeycloakAuth, useUpdateKeycloakAuth } from '@/hooks/use-keycloak-auth';
import { useHasPermission } from '@/hooks/use-has-permission';
import { Button } from './primitives/button';
import { showErrorToast, showSuccessToast } from './primitives/sonner-helpers';

const VIDE = { issuer: '', audience: '', subjectClaim: '' };

/** Hôtes pour lesquels `http://` reste acceptable — un bac à sable local, et rien d'autre. */
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Même règle que le serveur, pour que l'erreur arrive à la saisie et non à l'usage.
 *
 * L'émetteur ne sert pas qu'à comparer un claim : il détermine l'URL que l'API va chercher pour
 * récupérer les clés du realm. C'est un appel sortant depuis les serveurs izipush, d'où les deux
 * contraintes.
 */
function problemeEmetteur(valeur: string): string | null {
  if (!valeur.trim()) return null;

  let url: URL;
  try {
    url = new URL(valeur.trim());
  } catch {
    return 'Not a valid absolute URL.';
  }

  const local = HOTES_LOCAUX.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return 'https is required, except towards localhost.';
  }

  const ipLitterale = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':');
  if (ipLitterale && !local) return 'A literal IP address is not accepted — use a host name.';

  if (!/\/realms\/[^/]+$/.test(url.pathname.replace(/\/+$/, ''))) {
    return 'A Keycloak issuer ends with /realms/<realm>.';
  }

  return null;
}

export function KeycloakAuthCard() {
  const has = useHasPermission();
  const peutModifier = has({ permission: PermissionsEnum.API_KEY_WRITE });

  const { data, isLoading } = useFetchKeycloakAuth();
  const mutation = useUpdateKeycloakAuth();

  const [valeurs, setValeurs] = useState(VIDE);
  const [initial, setInitial] = useState(VIDE);

  useEffect(() => {
    if (!data) return;
    const charge = { ...VIDE, ...data.data };
    setValeurs(charge);
    setInitial(charge);
  }, [data]);

  const probleme = problemeEmetteur(valeurs.issuer);
  const modifie = JSON.stringify(valeurs) !== JSON.stringify(initial);
  const actif = !!initial.issuer;

  const enregistrer = async () => {
    try {
      const envoye = await mutation.mutateAsync(valeurs);
      setInitial({ ...VIDE, ...envoye.data });
      showSuccessToast(
        valeurs.issuer.trim()
          ? 'Keycloak authentication enabled for this environment.'
          : 'Keycloak authentication removed — this environment falls back to the subscriber JWT.'
      );
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Could not save the Keycloak settings');
    }
  };

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <CardHeader>
        Keycloak subscriber authentication
        <p className="text-foreground-500 mt-1 text-xs font-normal">
          When an issuer is set, device registration on this environment requires a Keycloak access token, and the
          subscriber id is read from its verified <span className="font-mono">sub</span> claim.
        </p>
      </CardHeader>
      <CardContent className="rounded-b-xl border-t bg-neutral-50 bg-white p-4">
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-label-sm">Issuer</Label>
              <Input
                className="font-mono text-xs"
                placeholder="https://keycloak.izichange.com/realms/izichange"
                value={valeurs.issuer}
                disabled={!peutModifier || mutation.isPending}
                onChange={(event) => setValeurs((v) => ({ ...v, issuer: event.target.value }))}
              />
              {probleme && <p className="text-destructive text-xs">{probleme}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-label-sm">Expected client</Label>
                <Input
                  className="font-mono text-xs"
                  placeholder="izipay-mobile"
                  value={valeurs.audience}
                  disabled={!peutModifier || mutation.isPending}
                  onChange={(event) => setValeurs((v) => ({ ...v, audience: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-label-sm">Subject claim</Label>
                <Input
                  className="font-mono text-xs"
                  placeholder="sub"
                  value={valeurs.subjectClaim}
                  disabled={!peutModifier || mutation.isPending}
                  onChange={(event) => setValeurs((v) => ({ ...v, subjectClaim: event.target.value }))}
                />
              </div>
            </div>

            {/* Les trois points qui évitent une mauvaise surprise. Le deuxième surtout : c'est
                le contrôle qu'on oublie, et son absence est silencieuse. */}
            <ul className="text-foreground-400 space-y-1 text-xs">
              <li className="flex items-start gap-1.5">
                <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
                An empty issuer removes Keycloak authentication: this environment falls back to the subscriber JWT.
              </li>
              <li className="flex items-start gap-1.5">
                <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
                Set the expected client. Every client of a realm is signed by the same key, so without it a token
                issued for another client of the realm is accepted here.
              </li>
              <li className="flex items-start gap-1.5">
                <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
                The subscriber must already exist — this path does not create it, unlike{' '}
                <span className="font-mono">session/initialize</span>.
              </li>
            </ul>

            {actif && (
              <p className="text-foreground-400 text-xs">
                Clients must send the environment identifier in the{' '}
                <span className="font-mono">Novu-Application-Identifier</span> header.
              </p>
            )}

            {peutModifier && (
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="secondary"
                  mode="outline"
                  disabled={!modifie || !!probleme || mutation.isPending}
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
