# Link Monitor - Deploy em Debian 12

## Requisitos Mínimos
- Debian 12 (Bookworm) limpo
- 2 GB RAM
- 20 GB disco
- Acesso root
- Domínio apontando para o IP do servidor (para SSL)
- Conexão com a rede dos links monitorados (para SNMP/ping)

## Instalação Rápida

1. Configure o DNS do seu domínio apontando para o IP do servidor

2. Baixe o projeto do Replit (Download as ZIP)

3. Extraia no servidor:
   ```bash
   unzip link-monitor.zip -d /tmp/link-monitor
   cd /tmp/link-monitor
   ```

4. Execute a instalação:
   ```bash
   sudo bash deploy/install.sh
   ```

5. O script vai pedir:
   - Domínio (ex: monitor.marvitel.com.br)
   - Email para o certificado SSL
   - Senha do PostgreSQL
   - Chave de sessão (opcional, gera automaticamente)

6. Ao final, acesse: https://seu-dominio.com.br

## Atualização

1. Baixe a nova versão do Replit
2. Extraia no servidor
3. Execute:
   ```bash
   cd /tmp/nova-versao
   sudo bash deploy/update.sh
   ```

O script faz backup automático antes de atualizar.

## Comandos Úteis

```bash
# Status do serviço
sudo systemctl status link-monitor

# Logs em tempo real
sudo journalctl -u link-monitor -f

# Reiniciar
sudo systemctl restart link-monitor

# Parar
sudo systemctl stop link-monitor
```

## Backup do Banco de Dados

```bash
# Backup
sudo -u postgres pg_dump link_monitor > backup_$(date +%Y%m%d).sql

# Restaurar
sudo -u postgres psql link_monitor < backup_20241224.sql
```

## Estrutura de Arquivos

```
/opt/link-monitor/          # Aplicação
/opt/link-monitor/.env      # Variáveis de ambiente
/opt/link-monitor-backups/  # Backups automáticos
```
