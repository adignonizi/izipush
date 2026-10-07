# Keycloak de développement

Pour éprouver l'authentification des abonnés par jeton Keycloak sans toucher au Keycloak
d'Izichange.

## Démarrer

```bash
docker compose -f deploy/keycloak-dev/docker-compose.yml up
```

Console d'administration : <http://localhost:8088> — `admin` / `admin`.
L'émetteur du realm est alors :

```
http://localhost:8088/realms/izichange
```

## Côté izipush

Une seule chose : **déclarer l'émetteur sur l'environnement**, dans **API Keys** du tableau de
bord — l'émetteur ci-dessus, et `izipay-mobile` comme client attendu.

> **`http://` n'est accepté que vers `localhost`.** L'émetteur commande l'URL que l'API va
> chercher pour récupérer les clés du realm : c'est un appel sortant depuis vos serveurs, donc
> `https` est exigé partout ailleurs, et les adresses privées sont refusées.

## Obtenir un jeton

```bash
TOKEN=$(curl -s -X POST \
  'http://localhost:8088/realms/izichange/protocol/openid-connect/token' \
  -d 'client_id=izipay-mobile' -d 'grant_type=password' \
  -d 'username=client-test' -d 'password=test' | jq -r .access_token)

# Le `sub` est le subscriberId attendu par izipush :
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq -r '.sub, .azp, .iss'
```

## Enregistrer un jeton push

```bash
curl -i -X PUT "$NOVU_API/v1/widgets/credentials" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Novu-Application-Identifier: <applicationIdentifier de l'environnement>" \
  -H 'content-type: application/json' \
  -d '{"providerId":"fcm","credentials":{"deviceTokens":["jeton-de-test"]}}'
```

L'abonné doit **préexister** : `session/initialize` le créait au passage, ce chemin ne le fait
pas. Le créer d'abord si besoin :

```bash
curl -s -X POST "$NOVU_API/v1/subscribers" \
  -H "Authorization: ApiKey $API_KEY" -H 'content-type: application/json' \
  -d "{\"subscriberId\":\"<le sub du jeton>\"}"
```

## Les quatre refus à vérifier

Ce sont eux qui disent si le contrôle fonctionne vraiment — un `200` sur le chemin heureux ne
prouve pas grand-chose.

| Essai | Attendu |
|---|---|
| Jeton de `outil-interne` au lieu de `izipay-mobile` | `401 client inattendu` — même realm, même clé de signature |
| Émetteur en `http://` vers autre chose que localhost | `401` — appel sortant refusé |
| Jeton expiré (attendre 5 min, durée du realm) | `401 jeton expiré` |
| En-tête `Novu-Application-Identifier` omis | retombe sur le JWT d'abonné, donc `401` sans JWT valide |
