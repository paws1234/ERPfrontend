# T-0.DEPLOY.02 — the frontend image.
#
# Three stages, so the runtime carries the application and not the toolchain:
# `deps` and `build` have node_modules, TypeScript and the Next CLI; `runtime`
# has the standalone server bundle Next produces and nothing else. The API base
# URL is read from the environment when the container starts, so one image works
# against any backend without a rebuild.
FROM node:22-slim AS deps

# Same IPv4 preference as the backend image: pypi/npm publish AAAA records and
# these containers have no IPv6 route, which makes installs stall.
RUN printf 'precedence ::ffff:0:0/96  100\n' >> /etc/gai.conf

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


FROM node:22-slim AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The contract types this repository is built from are committed (lib/contract.d.ts),
# so the build needs no backend checkout and no network.
RUN npm run build


FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# Only what the server needs: the standalone bundle (which carries the trimmed
# node_modules and the built pages) and the static assets it serves.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# The image ships no compiler, no test runner and no package manager's dev tree;
# it runs as the plain `node` user Next's own base image provides.
USER node

EXPOSE 3000

# Exec form: node is PID 1 and stops on SIGTERM without a shell in the way.
CMD ["node", "server.js"]
