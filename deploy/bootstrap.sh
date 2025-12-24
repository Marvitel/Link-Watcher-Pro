#!/bin/bash
set -e

echo "=============================================="
echo "  Link Monitor - Bootstrap Installer"
echo "  Marvitel Telecomunicações"
echo "=============================================="
echo ""

VERSION="${1:-latest}"
INSTALL_DIR="/tmp/link-monitor-install"
REPO_URL="https://github.com/marvitel/link-monitor"

if [ "$EUID" -ne 0 ]; then
  echo "Execute como root: sudo bash bootstrap.sh [versao]"
  echo ""
  echo "Exemplos:"
  echo "  sudo bash bootstrap.sh          # Instala versão mais recente"
  echo "  sudo bash bootstrap.sh v1.0.0   # Instala versão específica"
  echo "  sudo bash bootstrap.sh update   # Atualiza instalação existente"
  exit 1
fi

echo "Instalando dependências básicas..."
apt update
apt install -y curl wget unzip git

echo ""
echo "Baixando Link Monitor ($VERSION)..."
rm -rf $INSTALL_DIR
mkdir -p $INSTALL_DIR

if [ "$VERSION" = "latest" ]; then
  git clone --depth 1 $REPO_URL.git $INSTALL_DIR
elif [ "$VERSION" = "update" ]; then
  if [ ! -d "/opt/link-monitor" ]; then
    echo "ERRO: Link Monitor não está instalado. Use: sudo bash bootstrap.sh"
    exit 1
  fi
  git clone --depth 1 $REPO_URL.git $INSTALL_DIR
  cd $INSTALL_DIR
  bash deploy/update.sh
  rm -rf $INSTALL_DIR
  exit 0
else
  git clone --depth 1 --branch $VERSION $REPO_URL.git $INSTALL_DIR
fi

cd $INSTALL_DIR
bash deploy/install.sh

echo ""
echo "Limpando arquivos temporários..."
rm -rf $INSTALL_DIR

echo ""
echo "Bootstrap concluído!"
