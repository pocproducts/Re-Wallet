FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile --filter @bestpath/api...

FROM deps AS build
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @bestpath/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
