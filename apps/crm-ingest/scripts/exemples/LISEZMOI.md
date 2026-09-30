# Jeux d'exemple pour l'import initial

Deux fichiers au format attendu par `scripts/import-izichange.mjs`, conçus comme
**jeu d'essai** : ils couvrent les cas limites du script, pas seulement des lignes
normales. Utiles pour éprouver la chaîne avant de recevoir l'export réel.

```bash
cd apps/crm-ingest
node scripts/import-izichange.mjs \
  --users scripts/exemples/users.csv \
  --transactions scripts/exemples/transactions.csv \
  --dry-run
```

Résultat attendu : 12 `account.registered`, 9 `kyc.validated`, 11
`account.logged_in`, 31 `transaction.completed`, et 4 transactions écartées.

## Ce que les cas limites éprouvent

| Ligne | Cas | Effet attendu |
|---|---|---|
| `usr_003` | `kyc_status: pending` | aucun `kyc.validated` |
| `usr_006` | `kyc_status: rejected` | aucun `kyc.validated` |
| `usr_012` | `kyc_status` vide | aucun `kyc.validated` |
| `usr_005` | sans email | profil créé, mais injoignable par email |
| `usr_007` | KYC validé sans `kyc_updated_at` | `created_at` repris comme date |
| `usr_008` | virgule dans un champ, pas de `last_login_at` | guillemets respectés, aucun `account.logged_in` |
| `tx_0007`, `tx_0009`, `tx_0016`, `tx_0028` | statuts `failed`, `pending`, `cancelled`, `refunded` | écartées |
| `tx_0013` | montant `"1200,00"` | virgule décimale acceptée |
| `tx_0014` | `productId` vide | rangée sous `unknown` |
| `tx_0031` | `user_id` absent de `users.csv` | abonné créé sans profil |

Les dates mêlent volontairement les deux formats acceptés : ISO 8601
(`2024-03-11T08:14:22Z`) et `AAAA-MM-JJ HH:MM:SS`.

## Deux pièges découverts en éprouvant ces fichiers

**Le séparateur de milliers n'est pas géré.** `"1 200,00"` est rejeté :
le script remplace la virgule par un point puis exige `^\d+(\.\d+)?$`.
L'espace fait échouer la validation. N'envoyer que des montants bruts —
`1200,00` ou `1200.00`.

**La casse des codes produits n'est pas normalisée.** `normalizeCrmProductId`
rogne les espaces mais ne met pas en minuscules : `Crypto` et `crypto`
créeraient **deux produits distincts** au catalogue. La casse doit être
identique dans l'export et dans le flux temps réel.

Codes utilisés ici : `crypto`, `wallet`, `virtual_card`.
