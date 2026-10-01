# Gabarits pour l'import initial

Deux fichiers au format attendu par `scripts/import-izichange.mjs`, réduits à
l'essentiel : les en-têtes exacts et quelques lignes montrant les valeurs.
À transmettre à Izichange comme modèle de l'export.

```bash
cd apps/crm-ingest
node scripts/import-izichange.mjs \
  --users scripts/exemples/users.csv \
  --transactions scripts/exemples/transactions.csv \
  --dry-run
```

Résultat attendu : 2 `account.registered`, 2 `kyc.validated`,
2 `account.logged_in`, 1 `transaction.completed`, rien d'écarté.

## Ce que les lignes montrent

| | |
|---|---|
| `usr_001` | ligne complète, dates au format ISO 8601 |
| `usr_002` | mêmes champs, dates au format `AAAA-MM-JJ HH:MM:SS` — les deux sont acceptés |
| `tx_0001` | transaction réussie rattachée à `usr_001`, produit `crypto` |

La description colonne par colonne, les valeurs reconnues et les cas limites —
KYC non validé, produit absent, statuts écartés — sont dans
`docs/izichangedocs/import-initial.html`.

## Deux pièges à connaître avant de produire l'export

**Le séparateur de milliers n'est pas géré.** `"1 200,00"` est rejeté : le
script remplace la virgule par un point puis exige `^\d+(\.\d+)?$`, et l'espace
fait échouer la validation. N'envoyer que des montants bruts — `1200,00` ou
`1200.00`.

**La casse des codes produits n'est pas normalisée.** `normalizeCrmProductId`
rogne les espaces mais ne met pas en minuscules : `Crypto` et `crypto`
créeraient **deux produits distincts** au catalogue. La casse doit être
identique dans l'export et dans le flux temps réel.

Codes retenus : `crypto`, `wallet`, `virtual_card`.
