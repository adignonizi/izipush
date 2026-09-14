# Environnement de dev du CRM izipush

Services nécessaires pour développer et tester le CRM en local. Référence : `docs/izichangedocs/plan-crm.html`.

```bash
docker compose -f docker/crm-dev/docker-compose.yml up -d     # démarrer
docker compose -f docker/crm-dev/docker-compose.yml ps        # état (tous « healthy »)
docker compose -f docker/crm-dev/docker-compose.yml down      # arrêter, données conservées
docker compose -f docker/crm-dev/docker-compose.yml down -v   # arrêter et effacer Mongo
```

| Service | Rôle | Adresse |
|---|---|---|
| MongoDB 8.0 | base Novu + collections `crm_*` | `mongodb://127.0.0.1:27018/novu-crm-dev` |
| Redis 7 | files BullMQ, quotas d'envoi | `127.0.0.1:6390` |
| RabbitMQ 3.13 | simule le flux d'événements d'Izichange | `amqp://izipush:izipush@127.0.0.1:5673` · interface <http://127.0.0.1:15673> |
| Mailpit A | faux fournisseur email n°1 | SMTP `127.0.0.1:1025` · interface <http://127.0.0.1:8025> |
| Mailpit B | faux fournisseur email n°2 | SMTP `127.0.0.1:1026` · interface <http://127.0.0.1:8026> |

Variables à donner aux apps Novu (api, worker, crm-ingest) :

```bash
MONGO_URL=mongodb://127.0.0.1:27018/novu-crm-dev
MONGO_AUTO_CREATE_INDEXES=true
REDIS_HOST=127.0.0.1
REDIS_PORT=6390
AMQP_URL=amqp://izipush:izipush@127.0.0.1:5673
```

Le poste de dev a peu de mémoire libre : les conteneurs ont des plafonds (`mem_limit`), et les compilations/tests du monorepo se lancent un par un.
