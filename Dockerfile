FROM node:26-bookworm AS build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir /package && npm pack --ignore-scripts --pack-destination /package

FROM node:26-bookworm AS runtime

LABEL org.opencontainers.image.title="Deckmate" \
      org.opencontainers.image.description="A local Markdown project board for teams of people and AI agents." \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production \
    DECKMATE_HOST=0.0.0.0 \
    DECKMATE_INDEX=/tmp/deckmate

WORKDIR /opt/deckmate
COPY --from=build /package/*.tgz /tmp/deckmate.tgz
COPY --from=build /build/package-lock.json ./
RUN tar -xzf /tmp/deckmate.tgz --strip-components=1 \
    && rm /tmp/deckmate.tgz \
    && npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && mkdir /data \
    && chown node:node /data

USER node
EXPOSE 4318
ENTRYPOINT ["node", "/opt/deckmate/bin/deckmate.mjs"]
CMD ["--data", "/data", "--port", "4318", "--no-open"]
