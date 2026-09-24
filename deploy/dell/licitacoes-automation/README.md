# Radar de licitações — n8n

Instância isolada para coleta **somente leitura** do PNCP. Não cadastra a empresa, não envia documentos, propostas ou lances.

## Acesso

- Editor n8n: `http://127.0.0.1:5679`
- Dados de execução do coletor: `./data/latest-run.json`
- Relatório legível: `./data/latest-report.md`
- Histórico: `./data/history/`

A instância é local. Não publique a porta 5679 sem configurar domínio, TLS e autenticação apropriada.

## Fluxo

1. O workflow `Radar PNCP — coleta diária` agenda uma execução diária às 07:30 (America/Sao_Paulo).
2. O n8n solicita a coleta a um serviço local, privado e somente leitura. O serviço responde imediatamente com `202 Accepted` e um `collection_id`; a consulta ao PNCP continua em segundo plano.
3. Enquanto uma coleta estiver ativa, novas solicitações recebem o mesmo ID, sem criar trabalho duplicado. O estado pode ser consultado em `GET /collections/:id` dentro da rede Compose.
4. O coletor normaliza, filtra e pontua objetos alinhados a design, interiores e pós-produção de vídeo.
5. Resultados, falhas, histórico e estado de deduplicação são gravados em `data/`; cada execução também fica em `data/collections/`.
6. O cron Hermes das 08:00 pode ler esse relatório para enviar o resumo ao WhatsApp.

## Critérios iniciais

- Palavras-chave: design gráfico, identidade visual, comunicação visual, UX/UI, interface, audiovisual, edição de vídeo, motion, pós-produção e design de interiores.
- Bloqueios: obras/engenharia, fabricação/impressão/instalação pesada, hardware/licenças, mídia paga e exigências incompatíveis descritas no objeto.
- Faixa econômica preferida: R$5.000–R$80.000 quando o valor estiver publicado.
- O score é triagem técnica. Não confirma habilitação; isso depende do edital e anexos.

## Operação

```bash
docker compose up -d
docker compose exec n8n node /opt/licitacoes/scripts/collect-pncp.mjs
docker compose logs -f n8n
```

Depois da primeira abertura do editor, crie o proprietário local do n8n. O workflow é importado e ativado durante a implantação.

A coleta diária lê no máximo 20 páginas. Cada chamada ao PNCP tem limite de 90 segundos e no máximo 3 tentativas, com 15 segundos de espera entre elas (valores no `docker-compose.yml`). Se a fonte continuar lenta ou indisponível, a falha é persistida de forma controlada e a próxima tentativa fica para o acionamento seguinte. Para testar no editor do n8n, use o nó `Teste manual`.

## Segurança

- Segredos ficam somente em `.env` com permissão 600.
- O Postgres não possui porta publicada no host.
- A porta do n8n está ligada apenas a `127.0.0.1`.
- A pasta de documentos empresariais ainda não é montada no container. Essa integração deve ser feita depois, em modo de leitura, com uma política explícita de arquivos e validade.
