FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./
COPY prompts ./prompts
COPY workflows ./workflows
COPY remotion-infographics ./remotion-infographics

EXPOSE 8080

CMD ["sh", "-c", "node_modules/.bin/tsx src/server/cli.ts --host 0.0.0.0 --port ${PORT:-8080} --mode remote"]
