FROM node:22-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN pnpm build

FROM node:22-slim AS runtime

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/apps/api/dist apps/api/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "apps/api/dist/apps/api/src/index.js"]
