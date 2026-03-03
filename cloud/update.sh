#!/bin/bash
# Claude Terminal Cloud — Auto-Update Script
# Checks for updates and rebuilds the container if needed.
# Designed to run via cron or manually.

set -e

INSTALL_DIR="/opt/ct-cloud"
LOG_FILE="/var/log/ct-cloud-update.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE" 2>/dev/null || true
}

# Ensure we're in the right directory
if [ ! -d "$INSTALL_DIR" ]; then
  log "ERROR: Install directory not found at $INSTALL_DIR"
  exit 1
fi

cd "$INSTALL_DIR"

# Unshallow if needed (handles old --depth 1 clones), then fetch tags
git fetch --unshallow --quiet 2>/dev/null || true
git fetch origin --tags --quiet 2>/dev/null

# Get latest semver tag
LATEST_TAG=$(git tag -l "v*" | sort -V | tail -1)

if [ -z "$LATEST_TAG" ]; then
  log "ERROR: No release tags found"
  exit 1
fi

# Compare current HEAD with the tag commit
LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null)
TAG_HASH=$(git rev-parse "$LATEST_TAG^{commit}" 2>/dev/null)

if [ "$LOCAL_HASH" = "$TAG_HASH" ]; then
  log "Up to date at $LATEST_TAG"
  exit 0
fi

log "New release available: $LATEST_TAG"

# Checkout the tag
git checkout "$LATEST_TAG" --quiet 2>/dev/null
log "Checked out $LATEST_TAG"

# Rebuild and restart container
cd cloud
docker compose up -d --build --quiet-pull 2>/dev/null
log "Container rebuilt and restarted"

# Get new version
NEW_VERSION=$(docker exec ct-cloud node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
log "Updated to v$NEW_VERSION"
