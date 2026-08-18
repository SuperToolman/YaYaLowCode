FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY agent/package.json ./agent/package.json
RUN pnpm install --frozen-lockfile
COPY agent ./agent
WORKDIR /app/agent
EXPOSE 8789
CMD ["pnpm", "start"]
