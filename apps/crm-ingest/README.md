# crm-ingest

Service du CRM izipush : reçoit les événements d'Izichange et tient à jour, dans la base Novu, le **profil** de chaque client (subscriber) et son **activité** jour par jour. Architecture : `docs/izichangedocs/architecture-crm.html` §05.

```
Keycloak ─ webhook ─┐
                    ├─ adaptateur → validation → dédoublonnage → journal (crm_events)
RabbitMQ ─ file ────┘                                               │
                                                     job « crm-derive » par client (BullMQ)
                                                                    │
                                   subscriber (profil) · crm_activity_daily · cumuls à vie
```

## Entrées

| Source | Détail |
|---|---|
| RabbitMQ | File `AMQP_QUEUE` liée à l'exchange existant `AMQP_EXCHANGE` (motifs `AMQP_BINDINGS`). Les autres consommateurs ne sont pas affectés. |
| Keycloak | `POST /v1/webhooks/keycloak`, signature `X-Keycloak-Signature` (HMAC-SHA256 hex du corps) si `KEYCLOAK_WEBHOOK_SECRET` est défini. |

| Événement | Effet |
|---|---|
| `account.registered` (REGISTER) | crée le profil : identité, pays, `data.account_created_at` |
| `account.profile_updated`, `account.email_updated` | met à jour l'identité |
| `account.deleted` | `data.isDeleted = true`, tokens push effacés |
| `account.logged_in` (LOGIN) | `data.last_login_at` |
| `kyc.submitted` / `approved` / `rejected` | `data.kyc_status` (+ date de validation, motif de rejet) |
| `transaction.completed` / `failed` | ligne d'activité du jour, `data.lifetime_*`, `data.first_tx_at*`, `data.last_tx_at` |

Tout autre événement est acquitté et ignoré. Un message inexploitable part dans la file `AMQP_QUEUE.dlq` ; `POST /v1/crm-ingest/dead-letters/replay?limit=100` (en-tête `x-crm-admin-token`) le remet en file une fois la cause corrigée.

## Garanties

- **Doublons** : index unique sur l'`eventId` de l'émetteur.
- **Désordre** : chaque champ du profil garde la date du fait qui l'a produit (`crm_profile_state`) ; un fait plus ancien ne l'écrase pas.
- **Rejouable** : l'activité est recalculée depuis le journal (`$set`, jamais `$inc`) ; un recalcul interrompu peut être relancé.
- **Un client à la fois** : un seul job de recalcul par client ; un balayage chaque minute rattrape les événements restés en attente.

## En local

```bash
docker compose -f docker/crm-dev/docker-compose.yml up -d
cp apps/crm-ingest/src/.example.env apps/crm-ingest/src/.env
pnpm --filter @novu/crm-ingest build && (cd apps/crm-ingest && node dist/main)
node apps/crm-ingest/scripts/demo-lot1.mjs    # démo : doit afficher 8 ✅
pnpm --filter @novu/crm-ingest test           # tests unitaires
```
