#!/bin/bash
# Benchmarks resource consumption across all running agent containers and projects maximum safe capacity

echo "============================================================"
echo "    Minecraft AI Civilization — Resource Benchmark Tool     "
echo "============================================================"
echo ""

echo "==> Fetching current live Docker container metrics..."
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

echo ""
echo "============================================================"
echo "    VPS Capacity Projection (16GB RAM / 8 Cores Budget)     "
echo "============================================================"

TOTAL_RAM_MB=16384
SERVER_BASE_MB=2500
SUPPORT_SERVICES_MB=512 # Memory Service (256MB) + Brain Broker (256MB)
AVAILABLE_FOR_AGENTS_MB=$((TOTAL_RAM_MB - SERVER_BASE_MB - SUPPORT_SERVICES_MB - 2048)) # 2GB host OS reserve
PER_AGENT_AVG_MB=150

SAFE_MAX_AGENTS=$((AVAILABLE_FOR_AGENTS_MB / PER_AGENT_AVG_MB))

echo "Host Total RAM:              16,384 MB (16 GB)"
echo "Host OS & System Reserve:     2,048 MB (2 GB)"
echo "Paper Minecraft Server Limit: 2,500 MB (2.5 GB)"
echo "Broker + Memory Services:       512 MB"
echo "------------------------------------------------------------"
echo "Available RAM for Bot Agents: ${AVAILABLE_FOR_AGENTS_MB} MB"
echo "Estimated RAM per Agent:        ~${PER_AGENT_AVG_MB} MB (with 256MB hard cap)"
echo "------------------------------------------------------------"
echo ">> PROJECTED SAFE CONCURRENT AGENT CAPACITY: ${SAFE_MAX_AGENTS} AGENTS <<"
echo "============================================================"
