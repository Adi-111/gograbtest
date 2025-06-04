#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate dev

echo "Starting server..."
exec node dist/main.js
