import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Card, CardContent, CardHeader } from '@/components/primitives/card';
import { CodeBlock } from '@/components/primitives/code-block';
import { Container } from '@/components/primitives/container';
import { ExternalLink } from '@/components/shared/external-link';
import { useEnvironment } from '@/context/environment/hooks';
import { apiHostnameManager } from '@/utils/api-hostname-manager';

const SDK_REPO_URL = 'https://github.com/GITTESTMAG/izipush-sdk';

function ConfigTable({ rows }: { rows: { field: string; required: string; description: string }[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="bg-neutral-50">
            <th className="text-foreground-950 border-b border-neutral-200 p-2.5 font-medium">Champ</th>
            <th className="text-foreground-950 border-b border-neutral-200 p-2.5 font-medium">Obligatoire</th>
            <th className="text-foreground-950 border-b border-neutral-200 p-2.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className="border-b border-neutral-100 last:border-0">
              <td className="text-foreground-950 p-2.5 font-mono">{row.field}</td>
              <td className="text-foreground-600 p-2.5">{row.required}</td>
              <td className="text-foreground-500 p-2.5">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="w-full overflow-hidden shadow-none">
      <CardHeader>
        {title}
        {description && <p className="text-foreground-500 mt-1 text-xs font-normal">{description}</p>}
      </CardHeader>
      <CardContent className="rounded-b-xl border-t bg-white p-4">
        <div className="flex flex-col gap-4">{children}</div>
      </CardContent>
    </Card>
  );
}

export const SdkDocsPage = () => {
  const { currentEnvironment } = useEnvironment();
  const applicationIdentifier = currentEnvironment?.identifier ?? '<application-identifier>';
  const novuApiUrl = apiHostnameManager.getHostname() || 'https://<votre-instance-novu>';

  return (
    <>
      <PageMeta title="SDK Documentation" />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">SDK Documentation</h1>}>
        <Container className="flex w-full max-w-[900px] flex-col gap-6">
          <div>
            <p className="text-foreground-500 text-sm">
              <span className="font-mono">@gittestmag/izipush-sdk</span> — un seul package pour brancher le push
              (Android, iOS, Web) sur cet environnement Novu. Gère la permission de notification, le token push, son
              enregistrement, son renouvellement et son affichage — l'app hôte n'a que 1 à 2 fonctions à appeler.{' '}
              <ExternalLink href={SDK_REPO_URL} className="text-foreground-500">
                Voir le dépôt
              </ExternalLink>
              .
            </p>
          </div>

          <Section
            title="Comment le SDK parle à Novu"
            description="Aucun serveur intermédiaire, et jamais la clé secrète d'environnement côté client."
          >
            <p className="text-foreground-600 text-sm">
              Le SDK utilise le flux public de Novu — le même que le widget notification center — plutôt que les
              routes protégées par clé secrète :
            </p>
            <ol className="text-foreground-600 list-decimal space-y-1 pl-5 text-sm">
              <li>
                <span className="font-mono text-xs">POST /v1/widgets/session/initialize</span> — avec l'identifiant{' '}
                <strong>public</strong> de cet environnement (voir ci-dessous, sans risque à embarquer côté client),
                obtient un JWT scopé à un seul subscriber.
              </li>
              <li>
                <span className="font-mono text-xs">PUT /v1/widgets/credentials</span> — authentifié par ce JWT,
                enregistre le token push. Le JWT empêche un appelant de toucher aux credentials d'un subscriber autre
                que le sien.
              </li>
            </ol>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-900">
                <strong>Mode sécurisé (HMAC) actif sur cet environnement.</strong> L'étape 1 exige un{' '}
                <span className="font-mono">hmacHash</span>, calculé côté backend de l'app hôte — jamais côté client.
                Sans lui, n'importe qui connaissant un <span className="font-mono">subscriberId</span> pourrait
                obtenir une session en son nom et détourner ses notifications.
              </p>
            </div>
            <CodeBlock
              title="Backend de l'app hôte (Node)"
              language="typescript"
              code={`import { createHmac } from 'crypto';

// subscriberId = l'identifiant interne de l'utilisateur/terminal authentifié
const hmacHash = createHmac('sha256', process.env.NOVU_API_KEY!)
  .update(subscriberId)
  .digest('hex');

// à renvoyer à l'app, avec applicationIdentifier et novuApiUrl (voir plus bas)
res.json({ hmacHash });`}
            />
          </Section>

          <Section title="Installation">
            <CodeBlock language="shell" code={`npm install @gittestmag/izipush-sdk`} />
            <p className="text-foreground-500 text-xs">
              Nécessite un accès au registre GitHub Packages de l'organisation.
            </p>
            <CodeBlock
              title="Puis, selon la plateforme"
              language="shell"
              code={`# React Native
npm install @react-native-firebase/app @react-native-firebase/messaging @notifee/react-native

# Web
npm install firebase`}
            />
          </Section>

          <Section
            title="Intégration React Native (Android + iOS)"
            description="Metro résout automatiquement dist/index.native.js — même API que le web, config propre à la plateforme."
          >
            <p className="text-foreground-600 text-sm font-medium">Prérequis</p>
            <ul className="text-foreground-600 list-disc space-y-1 pl-5 text-sm">
              <li>Un projet Firebase avec une app Android et une app iOS enregistrées.</li>
              <li>
                <span className="font-mono text-xs">google-services.json</span> (Android) dans{' '}
                <span className="font-mono text-xs">android/app/</span>.
              </li>
              <li>
                <span className="font-mono text-xs">GoogleService-Info.plist</span> (iOS) ajouté au projet Xcode.
              </li>
              <li>
                Permission Android :{' '}
                <span className="font-mono text-xs">android.permission.POST_NOTIFICATIONS</span>.
              </li>
            </ul>

            <p className="text-foreground-600 text-sm font-medium">
              index.js — avant <span className="font-mono text-xs">AppRegistry</span>, jamais dans un composant
            </p>
            <CodeBlock
              language="typescript"
              code={`import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerBackgroundHandler } from '@gittestmag/izipush-sdk';

registerBackgroundHandler({
  novuApiUrl: '${novuApiUrl}',
  applicationIdentifier: '${applicationIdentifier}',
});

AppRegistry.registerComponent(appName, () => App);`}
            />

            <p className="text-foreground-600 text-sm font-medium">Après authentification de l'utilisateur</p>
            <CodeBlock
              language="typescript"
              code={`import { initPush } from '@gittestmag/izipush-sdk';

const { hmacHash } = await backend.getPushSession(currentUser.id);

const subscription = await initPush(currentUser.id, {
  novuApiUrl: '${novuApiUrl}',
  applicationIdentifier: '${applicationIdentifier}',
  hmacHash,
});

if (subscription === null) {
  // permission refusée — proposer de réactiver dans les paramètres
}`}
            />

            <ConfigTable
              rows={[
                { field: 'novuApiUrl', required: 'Oui', description: 'URL de base de l’API Novu' },
                { field: 'applicationIdentifier', required: 'Oui', description: 'Identifiant public de cet environnement' },
                { field: 'hmacHash', required: 'Selon l’environnement', description: 'Calculé côté backend (voir plus haut)' },
                { field: 'androidChannelId', required: 'Non', description: 'Défaut izipush-default' },
                { field: 'androidChannelName', required: 'Non', description: 'Défaut Notifications' },
              ]}
            />
          </Section>

          <Section
            title="Intégration Web (React)"
            description="Les bundlers web résolvent dist/index.js. Une asymétrie avec le mobile : le service worker."
          >
            <p className="text-foreground-600 text-sm font-medium">Prérequis</p>
            <ul className="text-foreground-600 list-disc space-y-1 pl-5 text-sm">
              <li>Le même projet Firebase, avec une app Web enregistrée.</li>
              <li>Une clé VAPID (console Firebase &gt; Cloud Messaging &gt; Web Push certificates).</li>
              <li>
                Le service worker packagé, copié dans le dossier public de l'app — un navigateur ne peut recevoir de
                push app fermée/onglet en arrière-plan que via un fichier statique servi à sa racine :
                <CodeBlock
                  className="mt-2"
                  language="shell"
                  code={`cp node_modules/@gittestmag/izipush-sdk/web/firebase-messaging-sw.js public/firebase-messaging-sw.js`}
                />
              </li>
            </ul>

            <p className="text-foreground-600 text-sm font-medium">Après authentification de l'utilisateur</p>
            <CodeBlock
              language="typescript"
              code={`import { initPush } from '@gittestmag/izipush-sdk';

const { hmacHash } = await backend.getPushSession(currentUser.id);

const subscription = await initPush(currentUser.id, {
  novuApiUrl: '${novuApiUrl}',
  applicationIdentifier: '${applicationIdentifier}',
  hmacHash,
  firebaseConfig: {
    apiKey: '...',
    projectId: '...',
    messagingSenderId: '...',
    appId: '...',
  },
  vapidKey: '...',
});`}
            />

            <ConfigTable
              rows={[
                { field: 'novuApiUrl', required: 'Oui', description: 'URL de base de l’API Novu' },
                { field: 'applicationIdentifier', required: 'Oui', description: 'Identifiant public de cet environnement' },
                { field: 'hmacHash', required: 'Selon l’environnement', description: 'Calculé côté backend (voir plus haut)' },
                { field: 'firebaseConfig', required: 'Oui', description: 'Config du projet Firebase (console Firebase)' },
                { field: 'vapidKey', required: 'Oui', description: 'Clé VAPID publique' },
                { field: 'serviceWorkerUrl', required: 'Non', description: 'Défaut firebase-messaging-sw.js' },
                { field: 'icon / badge', required: 'Non', description: 'Icônes des notifications au premier plan' },
              ]}
            />
          </Section>

          <Section title="API commune">
            <p className="text-foreground-600 text-sm">
              <span className="font-mono text-xs">
                initPush(userId: string, config: IzipushConfig): Promise&lt;{'{'} subscriberId; topic {'}'} | null&gt;
              </span>{' '}
              — demande la permission, récupère le token, l'enregistre, et met en place l'affichage. Retourne{' '}
              <span className="font-mono text-xs">null</span> si la permission est refusée ou la plateforme non
              compatible.
            </p>
            <p className="text-foreground-600 text-sm">
              <span className="font-mono text-xs">userId</span> doit être le{' '}
              <strong>même identifiant</strong> que celui utilisé côté métier (ex. le même{' '}
              <span className="font-mono text-xs">user_id</span>) — c'est ce qui permet au profil push de converger
              avec le profil enrichi par ailleurs sur le même abonné.
            </p>
          </Section>
        </Container>
      </DashboardLayout>
    </>
  );
};
