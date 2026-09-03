#!/bin/bash
# پاک‌سازی stack فعلی همین پوشه
set -euo pipefail

echo "Stopping current stack..."
docker-compose down -v --remove-orphans || true

if [ -f docker-compose.test.yaml ]; then
  docker-compose -f docker-compose.test.yaml down -v --remove-orphans || true
fi

echo "Done. Project files are still on disk."
echo "To delete the folder itself, run from parent directory:"
echo "  rm -rf \"\$(pwd)\""
