#!/bin/bash
set -e

echo "=============================================="
echo "  Link Monitor - Instalação para Debian 12"
echo "  Marvitel Telecomunicações"
echo "=============================================="
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "Execute como root: sudo bash install.sh"
  exit 1
fi

APP_DIR="/opt/link-monitor"
APP_USER="linkmonitor"
DB_NAME="link_monitor"
DB_USER="linkmonitor"

read -p "Domínio do sistema (ex: monitor.marvitel.com.br): " DOMAIN
read -p "Email para certificado SSL: " SSL_EMAIL
read -p "Senha do banco de dados PostgreSQL: " -s DB_PASS
echo ""
read -p "Chave secreta da sessão (deixe vazio para gerar): " SESSION_SECRET
if [ -z "$SESSION_SECRET" ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  echo "Chave gerada: $SESSION_SECRET"
fi

echo ""
echo "[1/8] Atualizando sistema..."
apt update && apt upgrade -y

echo ""
echo "[2/8] Instalando dependências..."
apt install -y curl wget git postgresql postgresql-contrib iputils-ping snmp snmpd nginx certbot python3-certbot-nginx ufw

echo ""
echo "[3/8] Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo ""
echo "[4/8] Configurando PostgreSQL..."
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || echo "Usuário já existe"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || echo "Banco já existe"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo ""
echo "[5/8] Criando usuário do sistema..."
id -u $APP_USER &>/dev/null || useradd -r -s /bin/false -d $APP_DIR $APP_USER

echo ""
echo "[6/8] Instalando aplicação..."
mkdir -p $APP_DIR
if [ -d "./client" ] && [ -d "./server" ]; then
  cp -r ./* $APP_DIR/
else
  echo "ERRO: Execute este script no diretório do projeto Link Monitor"
  exit 1
fi

cd $APP_DIR
npm install --production
npm run build

echo ""
echo "[7/8] Configurando variáveis de ambiente..."
cat > $APP_DIR/.env << EOF
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
SESSION_SECRET=$SESSION_SECRET
NODE_ENV=production
PORT=3000
EOF

chown -R $APP_USER:$APP_USER $APP_DIR
chmod 600 $APP_DIR/.env

echo ""
echo "[8/8] Configurando serviço systemd..."
cat > /etc/systemd/system/link-monitor.service << EOF
[Unit]
Description=Link Monitor - Sistema de Monitoramento
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "[9/8] Aplicando schema do banco de dados..."
cd $APP_DIR
export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
npm run db:push

echo ""
echo "[10/8] Iniciando serviços..."
systemctl daemon-reload
systemctl enable link-monitor
systemctl start link-monitor

echo ""
echo "[11/8] Configurando firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ""
echo "[12/8] Configurando Nginx com HTTPS..."
cat > /etc/nginx/sites-available/link-monitor << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/link-monitor /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo ""
echo "[13/8] Obtendo certificado SSL Let's Encrypt..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $SSL_EMAIL --redirect

echo ""
echo "[14/8] Configurando renovação automática do SSL..."
echo "0 3 * * * root certbot renew --quiet" > /etc/cron.d/certbot-renew

echo ""
echo "=============================================="
echo "  INSTALAÇÃO CONCLUÍDA!"
echo "=============================================="
echo ""
echo "Sistema disponível em: https://$DOMAIN"
echo ""
echo "Comandos úteis:"
echo "  sudo systemctl status link-monitor"
echo "  sudo systemctl restart link-monitor"
echo "  sudo journalctl -u link-monitor -f"
echo ""
echo "Credenciais iniciais:"
echo "  Email: admin@marvitel.com.br"
echo "  Senha: marvitel123"
echo ""
echo "IMPORTANTE: Altere a senha padrão após o primeiro acesso!"
echo ""
