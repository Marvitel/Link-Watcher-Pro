# Deploy - Link Monitor

Guia para deploy do Link Monitor em servidor próprio.

## Requisitos

- Docker e Docker Compose instalados
- Domínio configurado (DNS apontando para o IP do servidor)
- Porta 80 e 443 liberadas no firewall

## Passo a Passo

### 1. Clonar o repositório

```bash
git clone <seu-repositorio>
cd link-monitor
```

### 2. Configurar variáveis de ambiente

Execute o script de deploy uma vez para criar o arquivo `.env`:

```bash
chmod +x deploy.sh
./deploy.sh
```

Edite o arquivo `.env` com suas senhas:

```bash
nano .env
```

```env
DATABASE_URL=postgresql://linkmonitor:SENHA_FORTE@db:5432/linkmonitor
SESSION_SECRET=chave_gerada_automaticamente
POSTGRES_PASSWORD=SENHA_FORTE
```

### 3. Configurar certificado SSL

**Opção A - Let's Encrypt (gratuito):**

```bash
# Instalar certbot
sudo apt install certbot

# Gerar certificado (pare qualquer serviço na porta 80 antes)
sudo certbot certonly --standalone -d linkmonitor.marvitel.com.br

# Copiar certificados
mkdir -p ssl
sudo cp /etc/letsencrypt/live/linkmonitor.marvitel.com.br/fullchain.pem ssl/
sudo cp /etc/letsencrypt/live/linkmonitor.marvitel.com.br/privkey.pem ssl/
sudo chown $USER:$USER ssl/*.pem
```

**Opção B - Certificado próprio:**

```bash
mkdir -p ssl
cp /caminho/seu/certificado.crt ssl/fullchain.pem
cp /caminho/sua/chave.key ssl/privkey.pem
```

### 4. Executar deploy

```bash
./deploy.sh
```

## Comandos Úteis

```bash
# Ver logs em tempo real
docker-compose logs -f

# Ver logs apenas da aplicação
docker-compose logs -f app

# Reiniciar aplicação
docker-compose restart app

# Parar todos os serviços
docker-compose down

# Iniciar todos os serviços
docker-compose up -d

# Backup do banco de dados
docker-compose exec db pg_dump -U linkmonitor linkmonitor > backup.sql

# Restaurar backup
cat backup.sql | docker-compose exec -T db psql -U linkmonitor linkmonitor
```

## Renovação automática do Let's Encrypt

Adicione ao crontab:

```bash
sudo crontab -e
```

```
0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/linkmonitor.marvitel.com.br/*.pem /caminho/para/link-monitor/ssl/ && docker-compose -f /caminho/para/link-monitor/docker-compose.yml restart nginx
```

## Estrutura de Arquivos

```
link-monitor/
├── Dockerfile           # Build da aplicação
├── docker-compose.yml   # Orquestração dos containers
├── nginx.conf           # Configuração do proxy reverso
├── deploy.sh            # Script de deploy automatizado
├── .env                 # Variáveis de ambiente (não comitar!)
└── ssl/                 # Certificados SSL
    ├── fullchain.pem
    └── privkey.pem
```

## Troubleshooting

### Erro de conexão com banco de dados
```bash
docker-compose logs db
```

### Aplicação não inicia
```bash
docker-compose logs app
```

### Certificado SSL inválido
Verifique se os arquivos em `ssl/` estão corretos e se o domínio aponta para o IP do servidor.

### Porta 80/443 em uso
```bash
sudo lsof -i :80
sudo lsof -i :443
```
