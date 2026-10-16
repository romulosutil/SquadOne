---
name: conversa-do-lead
description: Ler a conversa de WhatsApp de um lead (Site antes da venda, PRUMO, Iris, estamparias, Plus) gravada no Dell e dizer em que passo da jornada ele está e qual a próxima mensagem. Use quando o Rômulo perguntar "em que pé está a conversa com X?", "o que eu respondo para X?", "X respondeu o quê?", ou antes de sugerir qualquer mensagem a um lead. Só leitura; você nunca envia nada a lead.
---

# Conversa do lead

Desde 16/10/2026 (pedido do Rômulo: o "em contato" não mostrava o que estava
acontecendo, e a etapa era adivinhada pelo trecho de 200 caracteres da planilha)
o observador do WhatsApp grava a conversa de cada **lead**, nas duas direções.
Antes de dizer em que etapa alguém está, **leia a conversa**; não adivinhe.

## Onde está

- `~/.local/share/whatsapp-conversas/<chave>.jsonl` (pasta 700, arquivo 600; o
  caminho pode mudar pela variável `WHATSAPP_CONVERSAS_DIR` do observador).
- `<chave>` = DDD + os 8 últimos dígitos do WhatsApp do lead (sem o 55). É o mesmo
  número que está na planilha; por isso **não repita a chave** em resposta nenhuma.
- Uma linha JSON por mensagem: `em` (UTC, ISO 8601), `direcao` (`entrada` = o lead
  escreveu; `saida` = o Rômulo escreveu), `texto` (até 2000 caracteres; mídia vem
  como `[áudio]`, `[imagem] legenda`...; `texto` vazio = a mensagem saiu mas o texto
  não foi registrado), `origem` (`pessoal` = bridge do Hermes, `prumo` = Evolution)
  e `id`. As linhas **não** estão garantidamente em ordem: ordene por `em`.
- Recibo de leitura não é linha (o "leu" está na planilha: `visto_em`, "Leu o
  convite em ..."). Quem não é lead não tem arquivo. Conversa anterior a 16/10/2026
  não existe aqui: para ela só há o trecho da planilha (`resposta_trecho`,
  `Resposta`). Linhas com mais de 120 dias são podadas.

## Achar o lead pelo nome (só leitura)

O retrato das planilhas que o n8n grava: `~/.local/share/n8n-estado/crm.json`
(`fontes.site`, `fontes.prumo`, `fontes.iris`, `fontes.estampa`: `linhas` são
objetos; `fontes.registros` é a aba CRM, com `empresa`, `tipo`, `texto`, `data`).
Os leads Plus ficam em `~/prumo-entregas/plus/leads.json`. Nunca edite esses
arquivos. Este trecho acha o lead pelo nome e imprime a etapa da planilha e a
conversa em ordem, **sem imprimir o telefone**:

```bash
python3 - "nome da empresa" <<'PY'
import json, os, re, sys, unicodedata
from datetime import datetime
alvo = sys.argv[1]
def norm(s): return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
def chave(bruto):
    d = re.sub(r"\D", "", str(bruto or "").split("?")[0])
    if len(d) >= 12 and d.startswith("55"): d = d[2:]
    return d[:2] + d[-8:] if 10 <= len(d) <= 11 else ""
pasta = os.environ.get("WHATSAPP_CONVERSAS_DIR") or os.path.expanduser("~/.local/share/whatsapp-conversas")
crm = json.load(open(os.path.expanduser("~/.local/share/n8n-estado/crm.json")))
campos = {"site": ("nome", "wa_me", ("status", "enviado_em", "respondeu_em", "visto_em", "resposta_tipo", "followup_em")),
          "prumo": ("Empresa", "WhatsApp", ("Etapa", "Próxima ação", "Convite enviado em", "Tipo da resposta", "Resposta em")),
          "iris": ("Empresa", "WhatsApp", ("Etapa", "Próxima ação", "Convite enviado em", "Respondeu em", "Tipo da resposta")),
          "estampa": ("Empresa", "WhatsApp", ("Etapa", "Próxima ação", "Convite enviado em", "Respondeu em", "Tipo da resposta"))}
for produto, (nome, tel, mostrar) in campos.items():
    for l in (crm["fontes"].get(produto) or {}).get("linhas") or []:
        if norm(alvo) not in norm(l.get(nome)):
            continue
        print(f"== {produto}: {l.get(nome)} | " + " | ".join(f"{c}: {l.get(c) or '-'}" for c in mostrar))
        arq = os.path.join(pasta, f"{chave(l.get(tel))}.jsonl")
        if not chave(l.get(tel)) or not os.path.exists(arq):
            print("   (sem conversa gravada)"); continue
        linhas = [json.loads(x) for x in open(arq, encoding="utf-8") if x.strip()]
        for m in sorted(linhas, key=lambda m: m.get("em", "")):
            quando = datetime.fromisoformat(m["em"].replace("Z", "+00:00")).astimezone().strftime("%d/%m %H:%M")
            quem = "lead" if m.get("direcao") == "entrada" else "você"
            print(f"   {quando} {quem}: {m.get('texto') or '(texto não registrado)'}")
for r in (crm["fontes"].get("registros") or {}).get("linhas") or []:
    if norm(alvo) in norm(r.get("empresa")):
        print(f"   registro {r.get('em', '')[:10]} {r.get('tipo')}: {r.get('texto') or ''}")
PY
```

Mais de um lead com o mesmo nome: diga quais achou (produto e cidade) e pergunte
qual. Nenhum: diga que não achou, nunca invente.

## "Em que etapa está X e qual a próxima mensagem?"

1. Rode o trecho acima e leia a conversa inteira, do começo.
2. Leia `~/SquadOne/docs/referencia/jornada-do-cliente.md` (os passos, quem faz,
   o que tira o lead de cada passo, prazos, o que oferecer a quem). Iris e
   estamparias andam no caminho curto descrito lá.
3. Decida o passo pela **conversa**: quem falou por último, o que o lead pediu ou
   recusou, se a 2ª mensagem (Raio-X ou demo) já saiu, se ele disse "gostei". A
   planilha é a referência de etapa; se a conversa disser outra coisa (ex.: a
   planilha diz "enviado" e ele já respondeu "quero ver"), diga a divergência.
   Mensagem do lead segundos depois da primeira mensagem costuma ser a saudação
   automática do WhatsApp Business, não resposta de gente.
4. Responda ao Rômulo, curto:
   - **Passo:** o nome do passo da jornada e a evidência (a última mensagem dele e
     a sua, com data e hora).
   - **Próximo passo:** o que tira o lead daqui, e o prazo se a jornada tiver.
   - **Rascunho da mensagem**, pronto para ele copiar, no tom da colinha (a mesma
     jornada; textos do Site em `deploy/dell/claude-ops/site-mensagem.js`). Preço
     só do cardápio; nunca invente número, prazo ou promessa. Lead com resposta
     negativa ou pedido de exclusão: o rascunho é o agradecimento, sem insistir.

## O que você nunca faz

- **Nunca envia nada a lead** (RULES 17): nem `hermes send`, nem navegador, nem
  WhatsApp Web. Quem envia é o Rômulo, pelo CRM ou pelo celular.
- Não repete telefone ou chave, não copia a conversa para memória, outro arquivo,
  skill ou canal; ela é só para responder o Rômulo, naquela conversa.
- Não edita os `.jsonl`, o `crm.json` nem as planilhas.
- Arquivo ilegível ou ausente é "não consegui ler", nunca uma suposição.
