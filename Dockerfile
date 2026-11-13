FROM node:20-alpine AS builder

WORKDIR /app

ENV DOCKER=true

RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json orval.config.ts ./
COPY bin/ ./bin/
COPY src/ ./src/

RUN npm run build

FROM node:20-alpine

WORKDIR /app

ENV DOCKER=true
ENV NODE_ENV=production

RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/build ./build

# Run as the unprivileged node user, not root (security review L6).
USER node

CMD ["node", "build/index.js", "--tools=all"]
