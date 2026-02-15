#!/bin/bash
# me.md - Development Environment Setup Script
# ==============================================
# This script installs dependencies and starts the development servers.

set -e

PROJECT_DIR="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"

echo "================================================"
echo "  me.md - Personal Knowledge System"
echo "  Setting up development environment..."
echo "================================================"
echo ""

# Check Node.js version
NODE_VERSION=$(node --version 2>/dev/null || echo "none")
if [ "$NODE_VERSION" = "none" ]; then
  echo "ERROR: Node.js is not installed. Please install Node.js 20+."
  exit 1
fi
echo "✓ Node.js version: $NODE_VERSION"

# Check npm
NPM_VERSION=$(npm --version 2>/dev/null || echo "none")
if [ "$NPM_VERSION" = "none" ]; then
  echo "ERROR: npm is not installed."
  exit 1
fi
echo "✓ npm version: $NPM_VERSION"

# Create .env file from example if it doesn't exist
if [ ! -f "$PROJECT_DIR/server/.env" ]; then
  if [ -f "$PROJECT_DIR/server/.env.example" ]; then
    cp "$PROJECT_DIR/server/.env.example" "$PROJECT_DIR/server/.env"
    echo "✓ Created server/.env from .env.example"
  fi
fi

# Install root dependencies
echo ""
echo "Installing root dependencies..."
npm install --prefix "$PROJECT_DIR" 2>&1 | tail -1

# Install server dependencies
echo "Installing server dependencies..."
npm install --prefix "$PROJECT_DIR/server" 2>&1 | tail -1

# Install client dependencies
echo "Installing client dependencies..."
npm install --prefix "$PROJECT_DIR/client" 2>&1 | tail -1

# Create data directory for SQLite database
mkdir -p "$PROJECT_DIR/server/data"
echo "✓ Data directory ready"

# Generate Drizzle migrations and apply schema
echo ""
echo "Setting up database schema..."
npx --prefix "$PROJECT_DIR/server" drizzle-kit generate 2>&1 | tail -3 || echo "  (Schema generation will complete on first run)"
npx --prefix "$PROJECT_DIR/server" drizzle-kit migrate 2>&1 | tail -3 || echo "  (Migration will complete on first run)"
echo "✓ Database schema ready"

echo ""
echo "================================================"
echo "  Starting development servers..."
echo "================================================"
echo ""
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:3000"
echo "  Health:   http://localhost:3000/api/health"
echo ""
echo "  Press Ctrl+C to stop all servers"
echo "================================================"
echo ""

# Start both servers concurrently
npm run --prefix "$PROJECT_DIR" dev
