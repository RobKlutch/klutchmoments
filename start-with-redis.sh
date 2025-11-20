#!/bin/bash

# Start with Redis script for Klutch Moments
echo "🚀 Starting Klutch Moments with Redis..."

# Function to check if Redis is running
check_redis() {
    redis-cli ping > /dev/null 2>&1
    return $?
}

# Function to start Redis
start_redis() {
    echo "📦 Starting Redis server..."
    redis-server --daemonize yes --port 6379 --save "" --appendonly no --dir /tmp --logfile /tmp/redis.log
    
    # Wait for Redis to start
    for i in {1..30}; do
        if check_redis; then
            echo "✅ Redis started successfully"
            return 0
        fi
        echo "⏳ Waiting for Redis to start... ($i/30)"
        sleep 1
    done
    
    echo "❌ Failed to start Redis after 30 seconds"
    return 1
}

# Check if Redis is already running
if check_redis; then
    echo "✅ Redis is already running"
else
    # Try to start Redis
    if ! start_redis; then
        echo "⚠️  Redis failed to start, but continuing anyway..."
        echo "⚠️  Job queue will operate in fallback mode"
    fi
fi

# Start the main application
echo "🎬 Starting Node.js application..."
if [ "$NODE_ENV" = "development" ]; then
    exec tsx server/index.ts
else
    exec node dist/index.js
fi