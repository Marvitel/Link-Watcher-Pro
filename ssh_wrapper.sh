#!/bin/bash
# Wrapper SSH com suporte a equipamentos legados
ssh_legacy() {
    ssh -F /home/runner/linkmonitor/ssh_legacy_config "$@"
}
alias ssh='ssh -F /home/runner/linkmonitor/ssh_legacy_config'
