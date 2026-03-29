#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CERT="/Users/narendrakumar/Downloads/Java/banking-endpoints/setup/cov1cert03vm.crt"

# ── Kill existing processes on known ports ──────────────────
echo "⏹  Stopping services…"
for port in 4000 5173 3000 3001; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "   Killing port $port (PIDs: $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done
sleep 1
echo "   All ports freed."

# ── Start GroomPilot backend (Express :4000) ────────────────
echo "🚀 Starting GroomPilot backend on :4000…"
cd "$ROOT/apps/groompilot"
NODE_OPTIONS=--use-system-ca \
NODE_EXTRA_CA_CERTS="$CERT" \
PORT=4000 \
  npx tsx watch src/index.ts &> /tmp/groompilot-backend.log &
BACKEND_PID=$!

# ── Start GroomPilot frontend (Vite :5173) ──────────────────
echo "🚀 Starting GroomPilot frontend on :5173…"
cd "$ROOT/apps/groompilot-web"
npx vite --port 5173 &> /tmp/groompilot-frontend.log &
FRONTEND_PID=$!

# ── Wait for backend health ─────────────────────────────────
echo "⏳ Waiting for backend…"
for i in $(seq 1 15); do
  if curl -sf http://localhost:4000/api/health > /dev/null 2>&1; then
    echo "✅ Backend healthy"
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo "⚠️  Backend not responding after 15s — check /tmp/groompilot-backend.log"
  fi
  sleep 1
done

# ── Summary ─────────────────────────────────────────────────
echo ""
echo "Services running:"
echo "  Backend  → http://localhost:4000  (PID $BACKEND_PID)"
echo "  Frontend → http://localhost:5173  (PID $FRONTEND_PID)"
echo ""
echo "Logs:"
echo "  Backend  → /tmp/groompilot-backend.log"
echo "  Frontend → /tmp/groompilot-frontend.log"
echo ""
echo "To stop:  kill $BACKEND_PID $FRONTEND_PID"
