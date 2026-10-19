# Auditoria de fluxos — 19/10/2026

Pedido do Rômulo: auditar fluxos, mensagens, healthchecks, ações e n8n do SquadOne e do PRUMO, procurando
complexidade desnecessária, fluxos que se ramificam, duplicados, laços, que fingem fazer, docs que prometem
o que o código não faz, e resolver.

Nove auditores (estado vivo da Mel, healthchecks, n8n do Site, n8n do PRUMO, mensagens do servidor, vendas
no frontend, Hermes/WhatsApp, docs × código, repo `prumo`) acharam ~190 itens. Os ids (VIVO-, HC-, SITE-,
PRUMO-, MSG-, VEN-, DELL-, DOC-, PR-) aparecem nos commits e nos comentários onde a correção mora.

## O que mudou de comportamento (o que o Rômulo vê)

- **Abrir o WhatsApp nunca registra envio.** Na Central, "Enviei", "Enviei a proposta", "Marcar a recusa" e
  "Pular por hoje" são explícitos, e o "Enviei" fecha o aviso aberto no Telegram. O nó do n8n "04 · Clique no
  wa_link" passou a se chamar "(registra o clique)": só grava `clique_em`.
- **"Conversas para você" é a fila inteira de quem já foi contatado:** follow-up do 3º dia, "o que achou?"
  depois do link, proposta sem retorno, recusa a marcar e proposta a mandar, além das conversas. Antes esses
  passos só existiam no Telegram.
- **Um dono para follow-up e Perdido: a Central.** O n8n 05 só expira, em 7 dias (era 10, contra os 7 da
  Central). O follow-up vale do 3º ao 6º dia (antes, só no dia em que o n8n o marcava).
- **Ficha de lead Novo** mostra o botão de primeiro contato com as travas; a folha do time comercial diz
  "ativo, mas o ciclo está parado desde HH:MM" e "Quem envia hoje".
- **Vendedor do Telegram:** lead novo volta a ser avisado com o time pausado (a regra é a da Central); o teto
  de 40 conta só avisos enviados e o "quero ver" passa por cima; fora do "responder", não espera 4 min pelo
  copiloto.
- **Lembrete e "Google desconectado" não repetem depois de um reinício** (dedupe de 24 h em disco).
- **Monitor (dell-status):** prazo por verificação e total (não morre antes de gravar), DNS de verdade
  (TLS ao Telegram), daemons e `.path` parados aparecem, checks novos (Central, Telegram, Central atualizada,
  units falhas), serviço HTTP só "quebra" na 2ª rodada, falha crítica toca à noite, avisos de backup,
  atualizar-central, Silmer e n8n pelo Telegram, links para telas que existem.
- **Auto-reparo:** o socorro roda cada remédio uma vez e não gasta o Hermes sem ter o que ler; o healthwatch
  tem teto de 3 reinícios em 10 min, carência e marca de pausa, e não mexe mais no gateway; a Central só
  marca "atualizada" depois de construir e responder.
- **n8n:** a Fonte com IA consulta a fila a cada 30 s (era 5 s, ~17 mil execuções/dia), a Medição só envia
  quando as origens mudam; erro de execução sempre guardado; o aviso "Diagnóstico pronto" saiu (fica o do
  Mapa); convites do PRUMO sem o nó morto "Marcar como enviado".

## O que saiu (morto ou duplicado)

ProximaVenda.vue (órfã) e o que só ela usava; fila-de-envio.ts, anotacao-de-envio.ts, plano-do-dia.ts; o gate
do Balcão (cópia em JS que só escrevia uma coluna que ninguém lia); site-demos-pausa (a limpeza apaga antes);
site_antes_venda_watcher do Hermes (texto divergente, fora da fila); os scripts-remendo do PRUMO
(prumo-ajustes, -ajuste-planilha, -rodizio, -escolha, -aviso-fila, -desfazer-saudacao); os artefatos antigos de
ops/n8n/workflows; o fallback "jeito antigo" da fila de avisos em 16 scripts (burlava a regra do R$); o modo
posicional que recriava o Caçador de um export velho; as pausas do site-nichos (rodar de novo pausaria ~80
buscas); o premium do gerador; o cron do Hermes no aplicar-hermes.

No `prumo`: index.v1.html (caso inventado no ar), roteiro-raio-x.md com textos divergentes (virou estratégia),
vocabulário interno no site e na apresentação (agora barrado no pre-commit), arquivos mortos.

## Decisões que ficam com o Rômulo

1. **Time comercial:** o config diz `ativo:true` (18/10) e o timer está parado na Mel. Ligar o timer ou marcar a pausa.
2. **Luna e Jev em sombra** estão ligadas na Mel, mas não recebem tráfego desde que o Assistente substituiu o
   Pedir. Desligar ou apontar para o Assistente.
3. **O "comitê" Diego/Elisa/Carla** é 3 leituras do mesmo modelo. Manter ou reduzir a 1.
4. **Relatório semanal do Hermes** (segunda 8h30) lê dois arquivos de setembro que descrevem automações que não
   existem mais, e sai junto do funil-revisao. Atualizar o prompt, fundir ou aposentar.
5. **Jev no whatsapp-conversa.py**: ramo pronto desde 11/10 e nunca aplicado.
6. **PRUMO (produto):** um gerador de Mapa (o PDF do Dell não é o que o dono recebe); o Raio-X convida todos para
   o Mapa, mas o Mapa exige ~8 pessoas; "Fonte em dia" × "Manutenção da Fonte"; faixas do índice "a confirmar";
   a Fonte vendida (dados na conta do cliente) × a Fonte demo (hospedada pelo PRUMO); ICP × nichos do caçador;
   processo do lead que chega sozinho pelo site/anúncio.
7. **Coluna Briefing** do PRUMO serve a três coisas (porte, briefing, memória); separar só se o Lead Scout voltar.

## Na Mel, depois do merge (precisa de aprovação: escrita remota)

```bash
# 0. ~/SquadOne já está no merge (atualizar-central, até 10 min), ou:
git -C ~/SquadOne pull --ff-only
# 1. Cópias atrasadas: lista o install de cada uma; rode-os, a lib de aviso (~/.local/lib/mel/) primeiro
dell-status --instalados
# 2. Units: recarregar e reiniciar o que mudou
systemctl --user daemon-reload
systemctl --user restart dell-worker-healthwatch auto-entrada.path site-pastas.path entrada-organizar.timer \
  silmer-drive-sync.timer evolution-adaptador luna-workflows whatsapp-observador whatsapp-observador-prumo entrada
# 3. Aposentados
systemctl --user disable --now site-demos-pausa.timer site-antes-venda-watcher
rm -f ~/.config/systemd/user/site-demos-pausa.{service,timer} ~/.local/bin/site-demos-pausa \
  ~/.config/systemd/user/site-antes-venda-watcher.service ~/.hermes/scripts/site_antes_venda_watcher.py \
  ~/workspace/scripts/run-graphify.sh ~/.hermes/scripts/{entrada_organizar,graphify_projetos,sites_e_pendencias}.py \
  ~/.local/share/claude-ops/{prumo-ajustes,prumo-ajuste-planilha,prumo-rodizio,prumo-escolha,prumo-aviso-fila,prumo-desfazer-saudacao}.py \
  ~/.local/share/claude-ops/gate-de-envio.js
systemctl --user daemon-reload
# 4. Compose do n8n (o collector do Radar agora está no profile "radar"; precisa do Compose >= 2.20)
cd ~/licitacoes-automation && docker compose version && docker compose config --quiet && docker compose up -d --no-deps n8n
# 5. Republicar os fluxos do n8n, nesta ordem
cd ~/.local/share/claude-ops
python3 site-antes-da-venda.py --balcao
python3 fecha-ciclos.py            # renomeia o 04 pelo id; conferir que não há 2º fluxo em /webhook/enviar
python3 site-acompanhamento.py
python3 site-lead-acoes.py
python3 prumo-simples.py
python3 prumo-ofertas.py --estado && python3 prumo-ofertas.py && python3 prumo-ofertas.py --estado   # caçadores seguem pausados
python3 prumo-publico.py
# 6. Hermes: reaplica SOUL, skills e os remendos da bridge (envios e histórico), reinicia o gateway
~/.hermes/hermes-agent/venv/bin/python ~/SquadOne/deploy/hermes/scripts/aplicar-hermes.py
#    e apagar à mão, na memória do Hermes, a entrada velha "Até o PC novo chegar…"
# 7. Limpeza do estado vivo
systemctl --user list-units --type=scope | grep hermes-worker-cron-d12b6431a2e6   # ASMR pausado: parar o scope órfão
systemctl --user reset-failed squadone-escritorio-previa.service
# 8. Depois da 1ª passada do dell-status: marca de pausa para o que está parado de propósito
#    date +%d/%m/%Y > ~/.local/state/dell-status/pausa-<unit>
```

No `prumo`: republicar o `prumo-site` (saiu o index.v1.html; mapa.html e fonte.html mudaram).
