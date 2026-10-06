# syntax=docker/dockerfile:1
#
# Reference image for the conformance run. Works from two build contexts:
#
#   monorepo (Compose):  context = repo root, APP_DIR=doubles/nextjs-postgres, MONOREPO=1
#                        -> installs @deploydoubles/checks built from the monorepo instead of npm
#   split repo:          docker build -f docker/Dockerfile .   (APP_DIR=., MONOREPO=0)
#
# Platforms do not need this file; it is not at the repository root on purpose.

ARG MONOREPO=0

FROM node:24-slim AS checks-0
RUN mkdir -p /out

# The library under test, built and packed exactly as it would be published.
FROM node:24-slim AS checks-1
WORKDIR /src/checks/node
COPY checks/node/package.json checks/node/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY checks/node/ ./
RUN npm run build && mkdir -p /out && npm pack --pack-destination /out

FROM checks-${MONOREPO} AS checks

FROM node:24-slim AS app
WORKDIR /app
ARG APP_DIR=.
ARG MONOREPO=0

COPY ${APP_DIR}/package.json ${APP_DIR}/package-lock.json ./
COPY --from=checks /out/ /out/

# The committed package.json depends on @deploydoubles/checks by version.
# In the monorepo the library under test is installed from the working tree,
# so a pull request tests its own library code, not the published release.
RUN if [ "$MONOREPO" = "1" ]; then \
        npm install --no-audit --no-fund /out/deploydoubles-checks-*.tgz; \
    else \
        npm ci --no-audit --no-fund; \
    fi

COPY ${APP_DIR}/ ./
RUN npm run build

# The commit this image was built from, read by the report (REVISION file convention).
ARG REVISION=
RUN if [ -n "$REVISION" ]; then printf '%s\n' "$REVISION" > REVISION; fi

ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
