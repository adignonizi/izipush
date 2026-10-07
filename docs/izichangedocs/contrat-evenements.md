# Contrat d'événements — Izichange → izipush

**Sept événements** : deux sur le bus, quatre via Keycloak, un optionnel. C'est tout ce que le CRM consomme.

Les événements « Dérivé / batch » du catalogue (`03_Evenements_Marketing`) ne sont pas à émettre : dormance, paliers d'inactivité, scores, seuils et First Success Moments sont composés par izipush à partir des faits ci-dessous. C'est la règle 4 de votre propre contrat d'événement.

**Annotations** — `requis` · `conseillé` · `optionnel` · `ignoré`

---

## 1. Enveloppe

Celle de `02_Contrat_Evenement`, sans changement. Les champs non listés ci-dessous — `schema_version`, `published_at`, `tenant_id`, `source`, `marketing_priority`, `dedup_key`, `correlation_id` — sont acceptés sans être lus.

`test_flag` fait exception : un événement à `true` est **acquitté et jamais appliqué à un profil**. L'ingérer polluerait des profils de production avec des données fictives, que rien ensuite ne permettrait de distinguer.

```jsonc
{
  "event_id":    "9f1c2e64-1f4a-4c7e-9a10-2b3c4d5e6f70",  // requis · UUID v4 · STABLE : un rejeu du
                                                          //          même fait porte le même id et
                                                          //          sera ignoré
  "event_name":  "transaction.completed",                 // requis · un des noms du §2
  "occurred_at": "2026-07-28T14:32:11Z",                  // requis · ISO 8601 UTC · moment du FAIT
  "user_id":     "usr_8H2K9LM",                           // requis · = subscriberId Novu = celui
                                                          //          passé au SDK push
  "product_code": "crypto",                               // requis pour transaction.completed et
                                                          //          product.activated
  "application_id": "xfPKZgo5XNEV",                       // facultatif · environnement izipush visé
                                                          //          (voir ci-dessous)
  "payload":     { }                                      // voir §3
}
```

> **Un seul `user_id` partout** — Keycloak, bus, SDK push. Deux identifiants différents produisent deux profils, donc deux fois chaque campagne. C'est le point à confirmer avant tout le reste.

### `application_id` — à quel izipush l'événement s'adresse

Facultatif. Sans lui, l'événement est rangé dans l'environnement configuré côté izipush : c'est le comportement actuel, et il reste valable.

Sa valeur est l'**identifiant d'application** d'un environnement izipush, lisible dans Settings → API Keys. Il est public par nature — il est déjà embarqué dans les applications mobiles et les pages web — et ne donne accès à rien par lui-même.

Il sert à une seule chose : permettre à un même flux d'alimenter plusieurs environnements, typiquement recette et production, sans doubler le service d'ingestion.

Trois comportements, à connaître avant de l'émettre :

| Valeur envoyée | Ce qu'izipush en fait |
|---|---|
| absente | l'événement va dans l'environnement configuré |
| identifiant connu | l'événement va dans cet environnement |
| identifiant inconnu | **l'événement est rejeté** vers la file d'erreurs |

Le rejet est délibéré : retomber sur l'environnement par défaut rangerait des événements chez le mauvais destinataire sans que rien ne le signale. Une faute de frappe doit se voir.

> À n'émettre qu'une fois la valeur confirmée de part et d'autre. Un identifiant erroné n'abîme rien, mais tous les événements concernés partent en erreur.

---

## 2. Les événements

| # | Événement izipush | Transport | Source catalogue |
|---|---|---|---|
| 1 | `transaction.completed` | bus | remplace E015 à E019 |
| 2 | `kyc.validated` | bus | E011 |
| 3 | `product.activated` | bus | registre produits — optionnel, produit par produit (§3.3) |
| 4 | `account.registered` | Keycloak `REGISTER` | E001 |
| 5 | `account.profile_updated` | Keycloak `UPDATE_PROFILE` | — |
| 6 | `account.email_updated` | Keycloak `UPDATE_EMAIL` | — |
| 7 | `account.logged_in` | Keycloak `LOGIN` | — |

Le lien client ↔ produit se déduit des transactions : **la première transaction reçue sur un produit lie le client à ce produit.** L'événement 3 ne sert qu'aux produits qu'on obtient avant de s'en servir.

---

## 3. Payloads

### 3.1 `transaction.completed`

Le cœur du CRM. Sans le flux **complet** des transactions — toutes, pas seulement les premières — ni les cumuls, ni l'activité par fenêtre, ni aucun segment du plan Growth n'existent.

```jsonc
{
  "event_id":     "9f1c2e64-...",
  "event_name":   "transaction.completed",
  "occurred_at":  "2026-07-28T14:32:11Z",
  "user_id":      "usr_8H2K9LM",
  "product_code": "crypto",              // requis · code du registre produits :
                                         //          crypto | wallet | card | pay | izimoon | ishop…
  "payload": {
    "amount_usd": 150.5,                 // requis · nombre ≥ 0, EN USD · conversion faite chez vous
    "type":       "buy",                 // requis · buy | sell | topup | send | convert | payment |
                                         //          cashin… · distingue un achat d'un encaissement
    "txNo":       1                      // conseillé · rang de cette transaction pour ce client sur le
                                         //             produit de l'enveloppe · 1 = première
  }
}
```

> **`txNo` — pourquoi il compte**
>
> izipush sait déduire « première transaction sur ce produit » de ce qu'il a reçu. Mais si le flux démarre aujourd'hui, un client qui a fait 47 opérations crypto l'an dernier lui apparaît comme un nouveau : il déclenche à tort la célébration du premier usage.
>
> Ce compteur rend le « première fois » **vrai à la source**, immunisé contre un démarrage à froid, un trou dans le flux ou un import initial pas encore fait. Avec lui, `txNo == 1` **est** le First Success Moment du produit, et les cinq événements E015 à E019 n'ont plus lieu d'être.
>
> Il se compte **par produit**, celui de `product_code` : la 3ᵉ opération crypto d'un client porte `txNo: 3`, sa 1ʳᵉ opération carte porte `txNo: 1` le même jour.
>
> S'il est absent, izipush retombe sur sa propre déduction — dégradée, mais fonctionnelle.

### 3.2 `kyc.validated`

```jsonc
{
  "event_id":    "b7d2...",
  "event_name":  "kyc.validated",
  "occurred_at": "2026-07-28T14:32:11Z",
  "user_id":     "usr_8H2K9LM",
  "payload":     { }                     // aucun champ requis
}
```

Un client sans cet événement est considéré comme non validé : c'est ce qui rend le segment « KYC non complété » exprimable sans rien émettre de plus.

### 3.3 `product.activated` — optionnel, produit par produit

**À n'émettre que pour les produits qu'on obtient avant de s'en servir.** Une carte est créée puis rechargée puis utilisée ; un wallet est ouvert puis alimenté. Entre les deux, le client détient le produit sans qu'aucune transaction ne l'atteste — et c'est la cible d'activation la plus rentable.

Pour les produits où obtenir et utiliser sont le même geste, il n'y a rien à émettre : en crypto, le premier ordre *est* l'activation. La colonne `activation_event` du registre produits reste vide pour ceux-là.

```jsonc
{
  "event_id":     "a3c1...",
  "event_name":   "product.activated",
  "occurred_at":  "2026-07-28T14:32:11Z",
  "user_id":      "usr_8H2K9LM",
  "product_code": "card",                // requis · le produit obtenu
  "payload":      { }                    // aucun champ requis
}
```

**Les deux sources ne se contredisent jamais.** Le lien est un ensemble : la première des deux qui arrive l'établit, la seconde ne fait rien. Une carte activée lundi et utilisée vendredi donne un lien dès lundi ; la même carte reçue sans événement d'activation donne un lien vendredi. Rien à arbitrer, rien à synchroniser.

### 3.4 `REGISTER` → `account.registered`

Crée le profil client. Les champs de localisation conditionnent la moitié des segments du plan Growth.

```jsonc
{
  "id":     "3f9a1c2b-...",              // requis · identifiant Keycloak · dédoublonnage
  "time":   1758551467000,               // requis · epoch MILLISECONDES
  "type":   "REGISTER",
  "userId": "usr_8H2K9LM",               // requis · À LA RACINE, pas dans details
  "details": {
    "email":           "awa@example.com",     // requis · email valide · canal e-mail et désinscription
    "first_name":      "Awa",                 // conseillé · personnalisation
    "last_name":       "Diop",                // conseillé
    "country_code":    "CI",                  // requis · ISO 3166-1 alpha-2
                                              //          sans lui : aucune campagne géographique
    "language":        "fr",                  // requis · fr | en | pt · sans lui : on écrit à tout
                                              //          le monde dans la même langue
    "timezone":        "Africa/Abidjan",      // requis · IANA · sans lui : pas d'envoi à l'heure
                                              //          locale du client
    "phone_number":    "+2250700000000",      // conseillé · E.164 · inutile tant qu'aucun canal SMS ou
                                              //             WhatsApp n'existe, mais le collecter plus
                                              //             tard imposerait de reprendre toute la base
    "register_method": "form",                // ignoré · natif Keycloak, peut rester
    "username":        "awa.diop"             // ignoré
  }
}
```

### 3.5 `UPDATE_PROFILE` → `account.profile_updated`

Keycloak préfixe par `updated_` les champs modifiés. Un champ absent n'efface rien.

```jsonc
{
  "id":     "7c2e...",
  "time":   1758551500000,
  "type":   "UPDATE_PROFILE",
  "userId": "usr_8H2K9LM",
  "details": {
    "updated_first_name":  "Awa Marie",         // optionnel · seuls les champs modifiés
    "updated_last_name":   "Diop",              // optionnel
    "updated_email":       "awa.m@example.com", // optionnel
    "country_code":        "SN",                // optionnel
    "language":            "en",                // optionnel
    "timezone":            "Africa/Dakar",      // optionnel
    "phone_number":        "+2250700000001",    // optionnel
    "previous_first_name": "Awa"                // ignoré · natif Keycloak
  }
}
```

### 3.6 `UPDATE_EMAIL` → `account.email_updated`

```jsonc
{
  "id":     "9b41...",
  "time":   1758551600000,
  "type":   "UPDATE_EMAIL",
  "userId": "usr_8H2K9LM",
  "details": {
    "updated_email":  "awa.m@example.com",    // requis · email VALIDE · sinon l'événement est rejeté
    "previous_email": "awa@example.com"       // ignoré
  }
}
```

### 3.7 `LOGIN` → `account.logged_in`

Alimente la date de dernière connexion, utilisée par les relances d'inactifs.

```jsonc
{
  "id":      "a1d2...",
  "time":    1758551700000,
  "type":    "LOGIN",
  "userId":  "usr_8H2K9LM",
  "details": { }                              // aucun champ attendu
}
```

> **Transport Keycloak** — `POST /v1/webhooks/keycloak`, en-tête `X-Keycloak-Signature` = HMAC-SHA256 hexadécimal du corps brut. izipush accepte indifféremment le snake_case de Keycloak et le camelCase du bus : `first_name` = `firstName` = `updated_first_name`, `country_code` = `countryCode` = `country`, `phone_number` = `phone` = `phoneNumber`, `language` = `locale`, `timezone` = `time_zone`.

---

## 4. À fournir avec ce contrat

- La liste des `product_code` : `crypto`, `wallet`, `card`, `pay`, `izimoon`, `ishop`… telle qu'elle sera émise.
- La liste des `type` de transaction, par produit.
- La confirmation que le `user_id` est le même dans Keycloak, sur le bus et dans le SDK push.
- Si `application_id` est émis : la valeur retenue par environnement, confirmée des deux côtés.
- La structure, le format et la date de coupure de l'export initial `users` + `transactions`.

---