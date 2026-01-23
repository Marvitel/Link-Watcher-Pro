#!/bin/bash
set -e

echo "=============================================="
echo "  Link Monitor - Atualização"
echo "  Marvitel Telecomunicações"
echo "=============================================="
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "Execute como root: sudo bash update.sh"
  exit 1
fi

APP_DIR="/opt/link-monitor"
BACKUP_DIR="/opt/link-monitor-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ ! -d "$APP_DIR" ]; then
  echo "ERRO: Link Monitor não está instalado em $APP_DIR"
  echo "Execute install.sh primeiro."
  exit 1
fi

echo "[1/6] Criando backup..."
mkdir -p $BACKUP_DIR
tar --exclude='node_modules' --exclude='dist' -czf $BACKUP_DIR/backup_$TIMESTAMP.tar.gz -C /opt link-monitor
echo "Backup salvo em: $BACKUP_DIR/backup_$TIMESTAMP.tar.gz"

echo ""
echo "[2/6] Atualizando código via git..."
cd $APP_DIR
git fetch origin
git reset --hard origin/main
echo "Código atualizado para última versão"

echo ""
echo "[3/6] Parando serviço..."
systemctl stop link-monitor

echo ""
echo "[4/6] Instalando dependências..."
cd $APP_DIR
npm install --production

echo ""
echo "[5/6] Reconstruindo aplicação..."
npm run build

echo ""
echo "[6/6] Aplicando migrações do banco..."
source $APP_DIR/.env
npm run db:push

echo ""
echo "[7/6] Reiniciando serviço..."
chown -R linkmonitor:linkmonitor $APP_DIR
systemctl start link-monitor

sleep 3

if systemctl is-active --quiet link-monitor; then
  echo ""
  echo "=============================================="
  echo "  ATUALIZAÇÃO CONCLUÍDA!"
  echo "=============================================="
  echo ""
  echo "Serviço rodando normalmente."
  echo "Backup disponível em: $BACKUP_DIR/backup_$TIMESTAMP.tar.gz"
else
  echo ""
  echo "=============================================="
  echo "  ERRO NA ATUALIZAÇÃO!"
  echo "=============================================="
  echo ""
  echo "Serviço não iniciou. Restaurando backup..."
  rm -rf $APP_DIR
  tar -xzf $BACKUP_DIR/backup_$TIMESTAMP.tar.gz -C /opt
  systemctl start link-monitor
  echo "Backup restaurado."
fi
