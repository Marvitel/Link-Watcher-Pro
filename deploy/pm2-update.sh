#!/bin/bash
# Script de atualização para PM2
# Uso: cd /opt/link-monitor && sudo bash deploy/pm2-update.sh

set -e

echo "=== Link Monitor - Atualização PM2 ==="
echo ""

APP_DIR="/opt/link-monitor"
cd $APP_DIR

# Carregar variáveis de ambiente
if [ -f "$APP_DIR/.env" ]; then
  set -a
  source $APP_DIR/.env
  set +a
  echo "[OK] Variáveis de ambiente carregadas"
else
  echo "[ERRO] Arquivo .env não encontrado!"
  exit 1
fi

echo ""
echo "[1/4] Baixando atualizações..."
git fetch origin
git checkout main
git pull origin main

echo ""
echo "[2/4] Instalando dependências..."
npm install

echo ""
echo "[3/4] Compilando aplicação..."
npm run build

echo ""
echo "[4/4] Reiniciando serviço..."
pm2 restart link-monitor --update-env

sleep 3

echo ""
echo "=== Status do serviço ==="
pm2 status link-monitor

echo ""
echo "=== Versão atual ==="
curl -s http://localhost:5000/api/version 2>/dev/null || curl -s http://localhost:5001/api/version 2>/dev/null || echo "Aguardando inicialização..."

echo ""
echo "Para ver logs: pm2 logs link-monitor --lines 30"
