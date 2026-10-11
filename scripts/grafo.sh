#!/usr/bin/env bash
# Consulta o grafo do Graphify que mora no Dell, sem copiar nada para o PC.
# O grafo é gerado pelo Hermes (job "Graphify — projetos", 03:00, só AST, sem
# modelo); aqui só se lê. Nunca roda `graphify update` nem indexa.
#
#   scripts/grafo.sh query   SquadOne "como o turno chega ao Gemini" [orçamento]
#   scripts/grafo.sh explain SquadOne "orchestrator.ts"
#   scripts/grafo.sh path    SquadOne "telegram-bot.ts" "calendar.ts"
#   scripts/grafo.sh query   global   "quem lê o status.json do Dell"
#
# <projeto> é a pasta em ~/Mel/Grafos no Dell (ver ~/Mel/Grafos/RESUMO.md);
# `global` cruza todos os projetos. O orçamento (tokens) vale só para `query`;
# o padrão do graphify é ~2000 e ele avisa quando trunca.
set -eu

uso() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

[ "$#" -ge 3 ] || uso
cmd=$1
projeto=$2
shift 2

case "$cmd" in
  query | explain | path) ;;
  *) uso ;;
esac

if [ "$projeto" = "global" ]; then
  grafo='$HOME/.graphify/global-graph.json'
else
  # o nome vai para dentro de um caminho no Dell: só letras, números, ponto, _ e -
  case "$projeto" in
    *[!A-Za-z0-9._-]* | "") echo "projeto inválido: $projeto" >&2; exit 2 ;;
  esac
  grafo="\$HOME/Mel/Grafos/$projeto/graphify-out/graph.json"
fi

orcamento=""
if [ "$cmd" = "query" ] && [ "$#" -ge 2 ]; then
  orcamento=${!#}
  case "$orcamento" in
    '' | *[!0-9]*) echo "orçamento precisa ser um número de tokens" >&2; exit 2 ;;
  esac
  set -- "${@:1:$#-1}"
fi

# Argumentos do usuário vão por printf %q: o shell do Dell os recebe como texto.
remoto="graphify $cmd"
for a in "$@"; do
  remoto="$remoto $(printf '%q' "$a")"
done
remoto="$remoto --graph $grafo"
[ -n "$orcamento" ] && remoto="$remoto --budget $orcamento"

# No PC (Git Bash) o ssh que tem a chave é o do Windows; no Dell roda direto.
if command -v graphify > /dev/null 2>&1; then
  executar() { bash -c "$remoto"; }
elif [ -x /c/Windows/System32/OpenSSH/ssh.exe ]; then
  executar() { /c/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -o ConnectTimeout=10 mel "export PATH=\$HOME/.local/bin:\$PATH; $remoto"; }
else
  executar() { ssh -o BatchMode=yes -o ConnectTimeout=10 mel "export PATH=\$HOME/.local/bin:\$PATH; $remoto"; }
fi

# O aviso de versão da skill do graphify vai para a saída e não ajuda a quem lê.
executar 2>&1 | grep -v '^  warning: skill at ' || true
