#!/bin/bash
# Spawns a new agent container dynamically into the running Minecraft Civilization cluster
# Usage: ./scripts/spawn-agent.sh <AgentName> <PersonalitySeed>

AGENT_NAME=${1:-"Agent_$(date +%s | tail -c 4)"}
PERSONALITY=${2:-"friendly-explorer"}
CONTAINER_NAME="agent-$(echo "$AGENT_NAME" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"

echo "==> Spawning new Minecraft AI Agent..."
echo "    Agent Name:   $AGENT_NAME"
echo "    Personality:  $PERSONALITY"
echo "    Container:    $CONTAINER_NAME"

docker run -d \
  --name "$CONTAINER_NAME" \
  --network "minecraft-community_minecraft-network" \
  --memory="256m" \
  --cpus="0.5" \
  -e MC_HOST="minecraft-server" \
  -e MC_PORT=25565 \
  -e MC_USERNAME="$AGENT_NAME" \
  -e MC_VERSION="1.20.4" \
  -e COMMAND_PREFIX="!" \
  -e PERSONALITY_SEED="$PERSONALITY" \
  -e CONFIDENCE_THRESHOLD="0.6" \
  -e BROKER_URL="http://brain-broker:3001" \
  -e MEMORY_SERVICE_URL="http://memory-service:3002" \
  --restart unless-stopped \
  minecraft-community_agent-alpha:latest

echo "==> Agent container $CONTAINER_NAME successfully launched!"
