# izipush-crm — image de crm-ingest (même construction que apps/webhook).
FROM node:22.22.1-alpine3.22 AS dev_base
RUN apk add --no-cache g++ make py3-pip
ENV NX_DAEMON=false

RUN npm --no-update-notifier --no-fund --global install pm2@6.0.14 pnpm@11.0.9 && \
    pnpm --version

USER 1000
WORKDIR /usr/src/app

FROM dev_base AS dev
ARG PACKAGE_PATH

COPY --chown=1000:1000 ./meta ./deps ./pkg ./

RUN --mount=type=cache,id=pnpm-store-crm-ingest,target=/root/.pnpm-store \
    pnpm install --reporter=silent --filter "novuhq" --filter "{${PACKAGE_PATH}}..." \
    --frozen-lockfile --unsafe-perm --reporter=silent && \
    NODE_ENV=production pnpm build:crm-ingest

WORKDIR /usr/src/app/apps/crm-ingest
RUN cp src/.example.env dist/.env
RUN cp src/.env.development dist/.env.development
RUN cp src/.env.production dist/.env.production

WORKDIR /usr/src/app

# ------- DEPLOY ----------
FROM dev AS deploy

WORKDIR /usr/src/app
RUN pnpm --filter @novu/crm-ingest deploy --legacy --prod /usr/src/deploy

# ------- PRODUCTION BUILD ----------
FROM node:22.22.1-alpine3.22 AS prod

ENV CI=true

RUN npm --no-update-notifier --no-fund --global install pm2@6.0.14 && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER 1000
WORKDIR /usr/src/app

COPY --chown=1000:1000 --from=deploy /usr/src/deploy .
COPY --chown=1000:1000 --from=dev /usr/src/app/apps/crm-ingest/dist ./dist

# Une seule instance : le consommateur RabbitMQ et le worker de recalcul gèrent leur propre parallélisme.
ENTRYPOINT [ "sh", "-c", "pm2-runtime start dist/main.js -i 1" ]
