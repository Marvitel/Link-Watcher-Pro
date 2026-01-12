#!/bin/bash

set -e

echo "=== Link Monitor - Script de Deploy ==="
echo ""

DOMAIN="linkmonitor.marvitel.com.br"
SSL_DIR="./ssl"

if [ ! -f ".env" ]; then
    echo "Criando arquivo .env..."
    cat > .env << EOF
DATABASE_URL=postgresql://linkmonitor:SUA_SENHA_AQUI@db:5432/linkmonitor
SESSION_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=SUA_SENHA_AQUI
EOF
    echo "IMPORTANTE: Edite o arquivo .env com suas senhas antes de continuar!"
    echo ""
    exit 1
fi

echo "1. Verificando certificados SSL..."
if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
    echo ""
    echo "Certificados SSL nao encontrados em $SSL_DIR/"
    echo ""
    echo "Opcao 1 - Usar Let's Encrypt (recomendado):"
    echo "  sudo certbot certonly --standalone -d $DOMAIN"
    echo "  mkdir -p $SSL_DIR"
    echo "  sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $SSL_DIR/"
    echo "  sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $SSL_DIR/"
    echo "  sudo chown \$USER:$USER $SSL_DIR/*.pem"
    echo ""
    echo "Opcao 2 - Certificado proprio:"
    echo "  Copie seus certificados para $SSL_DIR/fullchain.pem e $SSL_DIR/privkey.pem"
    echo ""
    echo "Apos configurar os certificados, execute este script novamente."
    exit 1
fi

echo "2. Construindo containers..."
docker-compose build --no-cache

echo ""
echo "3. Iniciando servicos..."
docker-compose up -d

echo ""
echo "4. Aguardando banco de dados..."
sleep 10

echo ""
echo "5. Executando migracoes..."
docker-compose --profile migrations run --rm migrations

echo ""
echo "=== Deploy concluido! ==="
echo ""
echo "Acesse: https://$DOMAIN"
echo ""
echo "Comandos uteis:"
echo "  docker-compose logs -f        # Ver logs"
echo "  docker-compose restart app    # Reiniciar aplicacao"
echo "  docker-compose down           # Parar tudo"
echo "  docker-compose up -d          # Iniciar tudo"
echo ""
