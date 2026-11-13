# Node 22 LTS (Node 20 reached end of life in April 2026), pinned by digest. Update the digest when patching.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS builder

WORKDIR /app

ENV DOCKER=true

RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json orval.config.ts ./
COPY bin/ ./bin/
COPY src/ ./src/

RUN npm run build

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

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
