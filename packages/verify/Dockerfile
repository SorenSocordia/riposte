# The engine's HTTP service as a self-contained on-prem image. No outbound network at runtime: everything the verifier does
# happens inside this container, so the documents it checks never leave the machine that runs it.
#
# Build from the repository root, not from this folder: the image installs only from the root's package-lock.json, which pins
# every dependency of every package in the tree.
#   docker build -f packages/verify/Dockerfile -t riposte-verify .
# With no package-lock.json at the root the build stops at its first RUN and says so. It never falls back to an npm install that
# would resolve versions on the day the image is built.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ ! -f package-lock.json ]; then echo "riposte-verify image: no package-lock.json at the repository root, so nothing is installed: this image installs only with npm ci, from the lockfile. Build from the root of a tree that ships one: docker build -f packages/verify/Dockerfile -t riposte-verify ." >&2; exit 1; fi
COPY packages/verify/package.json packages/verify/
# npm ci from the lockfile, for this one workspace: under npm 10.9 (the npm this base image bundles) as under npm 11.
RUN npm ci -w riposte-verify --no-audit --no-fund
COPY packages/verify/tsconfig.json packages/verify/
COPY packages/verify/src packages/verify/src
# Build, then reinstall from the same lockfile without the build tools (npm ci for one workspace does not clear node_modules
# first, so it is removed here): the runtime image carries only what the engine imports.
RUN npm run build -w riposte-verify && rm -rf node_modules && npm ci -w riposte-verify --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/verify/package.json ./packages/verify/
COPY --from=build /app/packages/verify/dist ./packages/verify/dist
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Inside a container the server must listen on 0.0.0.0, or a published port cannot reach it; it prints a warning saying so,
# because the server has no authentication. Publish it on the host's loopback only (docker run -p 127.0.0.1:8080:8080) unless
# an authenticating proxy sits in front of it.
CMD ["node", "packages/verify/dist/cli.js", "serve", "--host", "0.0.0.0"]
