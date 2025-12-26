#!/bin/bash
set -e

GITHUB_REPO="https://github.com/Marvitel/Link-Watcher-Pro"
APP_DIR="/opt/link-monitor"
BACKUP_DIR="/opt/link-monitor-backups"
TEMP_DIR="/tmp/link-monitor-update"

echo "=========================================="
echo "  Link Monitor - Atualização via GitHub"
echo "=========================================="

if [ ! -d "$APP_DIR" ]; then
    echo "ERRO: Diretório $APP_DIR não encontrado."
    echo "Execute primeiro o install.sh para instalar o sistema."
    exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

echo ""
echo "[1/6] Criando backup em $BACKUP_PATH..."
cp -r "$APP_DIR" "$BACKUP_PATH"
echo "      Backup criado com sucesso!"

echo ""
echo "[2/6] Baixando código do GitHub..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

if command -v git &> /dev/null; then
    git clone --depth 1 "$GITHUB_REPO" "$TEMP_DIR/repo"
else
    echo "      Git não encontrado. Instalando..."
    apt-get install -y git
    git clone --depth 1 "$GITHUB_REPO" "$TEMP_DIR/repo"
fi

echo ""
echo "[3/6] Parando o serviço..."
systemctl stop link-monitor || true

echo ""
echo "[4/6] Atualizando arquivos..."
rsync -av --exclude='node_modules' --exclude='.env' --exclude='dist' \
    "$TEMP_DIR/repo/" "$APP_DIR/"

echo ""
echo "[5/6] Instalando dependências..."
cd "$APP_DIR"
npm install --production

echo ""
echo "[6/6] Reiniciando o serviço..."
systemctl start link-monitor

sleep 3

if systemctl is-active --quiet link-monitor; then
    echo ""
    echo "=========================================="
    echo "  ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!"
    echo "=========================================="
    echo ""
    echo "Backup salvo em: $BACKUP_PATH"
    echo ""
    echo "Para verificar os logs:"
    echo "  sudo journalctl -u link-monitor -f"
    echo ""
    rm -rf "$TEMP_DIR"
else
    echo ""
    echo "ERRO: Serviço não iniciou corretamente!"
    echo "Restaurando backup..."
    systemctl stop link-monitor || true
    rm -rf "$APP_DIR"
    mv "$BACKUP_PATH" "$APP_DIR"
    systemctl start link-monitor
    echo "Backup restaurado. Sistema voltou ao estado anterior."
    exit 1
fi
