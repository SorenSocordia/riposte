# Verify — deterministic document/action verifier, as a self-contained on-prem service.
# No outbound network at runtime: everything the verifier does happens inside this container. That is the whole point for
# regulated and sovereign-data buyers — their documents never leave their perimeter.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json* ./
RUN (npm ci --omit=dev 2>/dev/null || npm install --omit=dev) && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/http/serve.js"]
