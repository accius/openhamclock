#!/bin/sh
# OpenHamClock Docker Entrypoint
# Handles stats persistence directory setup

# Check if /data volume is writable
if [ -d "/data" ]; then
    if touch /data/.write-test 2>/dev/null; then
        rm -f /data/.write-test
        echo "[Entrypoint] /data volume is writable ✓"
        export STATS_FILE="/data/stats.json"
    else
        echo "[Entrypoint] /data volume exists but is not writable"
        echo "[Entrypoint] Stats will use in-memory storage only"
    fi
else
    echo "[Entrypoint] No /data volume mounted"
fi

# Start the application
exec node server.js
