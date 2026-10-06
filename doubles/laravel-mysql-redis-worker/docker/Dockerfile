# syntax=docker/dockerfile:1
#
# Reference image for the conformance run. Works from two build contexts:
#
#   monorepo (Compose):  context = repo root, APP_DIR=doubles/laravel-mysql-redis-worker, MONOREPO=1
#                        -> installs checks-php from the monorepo instead of Packagist
#   split repo:          docker build -f docker/Dockerfile .   (APP_DIR=., MONOREPO=0)
#
# Platforms do not need this file; it is not at the repository root on purpose.

ARG MONOREPO=0

FROM scratch AS checks-0

FROM scratch AS checks-1
COPY checks/php/ /

FROM checks-${MONOREPO} AS checks

FROM php:8.4-cli AS app
COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_mysql redis pcntl zip
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

WORKDIR /app
ARG APP_DIR=.
ARG MONOREPO=0

COPY ${APP_DIR}/composer.json ${APP_DIR}/composer.lock ./
COPY --from=checks / /src/checks/php/

# The committed composer.json requires deploydoubles/checks-php by version.
# In the monorepo the library under test is installed from the working tree,
# so a pull request tests its own library code, not the published release.
RUN if [ "$MONOREPO" = "1" ]; then \
        composer config repositories.checks '{"type": "path", "url": "/src/checks/php", "options": {"symlink": false, "versions": {"deploydoubles/checks-php": "0.1.99"}}}' \
        && composer update deploydoubles/checks-php --no-dev --no-scripts --no-autoloader --no-interaction --no-progress; \
    else \
        composer install --no-dev --no-scripts --no-autoloader --no-interaction --no-progress; \
    fi

COPY ${APP_DIR}/ ./
RUN composer dump-autoload --optimize --no-dev --no-scripts \
    && php artisan package:discover

# The commit this image was built from, read by the report (REVISION file convention).
ARG REVISION=
RUN if [ -n "$REVISION" ]; then printf '%s\n' "$REVISION" > REVISION; fi

ENV PHP_CLI_SERVER_WORKERS=4
EXPOSE 8080
# Caches the configuration from the mounted .env, then runs the command.
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8080", "--no-reload"]
