#!/bin/sh
# The usual production shape on PHP hosts: settings in a .env file, and the
# configuration cached at release time. With the cache in place Laravel never
# reads .env again, which is exactly what the deploy report has to cope with.
set -e
php artisan config:cache >&2
exec "$@"
