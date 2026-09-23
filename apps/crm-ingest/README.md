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

Contrat complet : `docs/izichangedocs/contrat-evenements.md`.

| Événement | Effet |
|---|---|
| `account.registered` (REGISTER) | crée le profil : identité, pays, langue, fuseau, `data.account_created_at` |
| `account.profile_updated`, `account.email_updated` | met à jour l'identité |
| `account.logged_in` (LOGIN) | `data.last_login_at` |
| `kyc.validated` | `data.kyc_status`, `data.kyc_validated_at` |
| `transaction.completed` | ligne d'activité du jour, `data.lifetime_*`, `data.product_*`, `data.last_tx_at` |
| `product.activated` | lie le client au produit sans attendre une transaction (`product_state.{id}.activated_at`) |

Tout autre événement est acquitté et ignoré. Un événement portant `test_flag: true` l'est aussi : les données de recette n'entrent jamais dans un profil. Un message inexploitable part dans la file `AMQP_QUEUE.dlq` ; `POST /v1/crm-ingest/dead-letters/replay?limit=100` (en-tête `x-crm-admin-token`) le remet en file une fois la cause corrigée.

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
