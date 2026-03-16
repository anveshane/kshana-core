FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/workflows ./workflows
COPY --from=build /app/remotion-infographics ./remotion-infographics

EXPOSE 8080

CMD ["sh", "-c", "node dist/server/cli.js --host 0.0.0.0 --port ${PORT:-8080} --mode remote"]
