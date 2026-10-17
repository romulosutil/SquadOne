"""Conversa no WhatsApp marca o lead sozinho (idempotente).

O Rômulo aborda os leads direto no WhatsApp, sem passar pelos links
rastreados, e não tem tempo de voltar à planilha. O observador
(`deploy/dell/whatsapp-observador/observador.py`) lê o log da bridge do Hermes,
que já está vinculado ao número dele, e avisa este n8n quando a conversa é com
um número das planilhas:

- GET  /webhook/whatsapp-telefones  -> {"chaves": [...]}: os números dos leads,
  que o observador usa como filtro (conversa com quem não é lead nunca sai dele);
- POST /webhook/whatsapp-conversa   {"chave", "direcao", "em", "seguinte"?}
  -> {"ok", "marcados": [{"planilha", "nome", "acao", "antes"}]}, respondido
  depois de ler as planilhas e antes de gravar (o observador usa "marcados"
  para avisar "você abordou ..."; um erro na gravação vira aviso de falha).

"PRUMO" abaixo vale também para as ofertas do PRUMO (14/10/2026, PRUMO como
holding): as abas Clínicas (Iris, planilha "iris") e Estamparias (CRM de
estamparia, "estampa") da mesma planilha, com o contrato do Prospects. Nelas a
resposta também grava "Respondeu em" (apagado se a classificação disser robô),
gente que responde passa a Etapa "Em conversa" (antes marcada à mão) e o
interesse pede combinar a demonstração, não o Raio-X. Abas e convites em
prumo-ofertas.json; aba que não lê é pulada, sem segurar Site e Prospects.

`direcao`:
- "saida" (30/09/2026): o Rômulo escreveu (linha owner_sent da bridge,
  remendada por deploy/hermes/scripts/patch_bridge_envios.py). Site antes da
  venda: "novo"/"pronto" -> "enviado" + enviado_em (acao "abordou", como o
  clique no wa_link); "recusado"/"expirado" -> "enviado" + enviado_em de agora
  (acao "retomou": o acompanhamento conta de novo; a pasta não muda);
  "enviado"/"fechado": conversa normal, nada muda. PRUMO: Etapa "Revisar" ->
  "Convite enviado" (como o clique em "Enviar convite"). Desde 07/10/2026 o
  lead que vira "enviado" aqui (por saida, lido ou entrada) ganha
  mensagem_variante "manual": o clique no wa_link já marca "enviado", então o
  texto não foi o da variação que o Balcão gravou.
- "entrada": o lead escreveu. PRUMO: Etapa "Revisar" -> "Convite enviado";
  "Convite enviado" -> Próxima ação "Respondeu no WhatsApp ..." só se a mensagem
  veio 5 min ou mais depois de "Convite enviado em" (desde 05/10/2026). Site
  (29/09/2026): "novo"/"pronto" -> "enviado" (+ enviado_em se vazio); resposta a
  5 min ou mais do envio -> respondeu_em (e "expirado" volta a "enviado"). A
  pasta do lead vai para _em-conversa pelo site-pastas do Dell (o Balcão lista
  o que mover).
- "lido" (30/09/2026): o lead leu uma mensagem do Rômulo (recibo azul). Site:
  visto_em, só a primeira vez (lido em "novo"/"pronto" também prova o envio e
  marca "enviado"). PRUMO com "Convite enviado": Próxima ação "Leu o convite em
  ...", se ainda não diz "Respondeu"/"Leu". Quem desligou a confirmação de
  leitura nunca aparece como lido: "entregue sem lido" é "não sei", não "não viu".

Por que 5 min: em 28/09/2026 dez leads "responderam" entre 16:30 e 16:49, na
ordem e no ritmo em que o Rômulo mandava, cada um segundos depois do envio. É a
saudação automática do WhatsApp Business, não gente. Por isso a primeira
mensagem de um lead "pronto" só prova o envio, e resposta é mensagem que chega a
5 min ou mais do envio. O observador manda um segundo aviso ("seguinte": true)
quando o lead volta a escrever depois desses 5 min; o PRUMO ignora esse
segundo aviso e continua marcando uma vez por janela.

O PRUMO ficou de fora dessa regra até 05/10/2026: qualquer mensagem de quem
tinha "Convite enviado" virava "Respondeu no WhatsApp". Dos 20 prospects
marcados assim, todos "responderam" até cerca de 5 min depois do convite e 17
em menos de 1 min. Eram saudações, e a tela Hoje do CRM listava "Respostas
para responder" e "Conversando" que não existiam. prumo-desfazer-saudacao.py
devolve as marcas antigas a "Só resposta automática".

Só número, direção e hora: o conteúdo das mensagens nunca sai do observador.
Os dois webhooks exigem o header X-Observador (credencial "Observador
WhatsApp"); o segredo mora em ~/.config/claude-ops/whatsapp-observador-segredo.

Chave de um número = DDD + últimos 8 dígitos: o WhatsApp guarda celulares
antigos sem o 9 da frente, e a planilha às vezes com; os dois lados batem.

Uso: python3 whatsapp-conversa.py            publica os dois fluxos e cria a coluna visto_em
     python3 whatsapp-conversa.py --colunas  só a coluna visto_em na aba Leads
     python3 whatsapp-conversa.py --testar   roda o código dos nós no node com planilhas de mentira
     python3 whatsapp-conversa.py --testar-n8n  cópia do fluxo no n8n com planilhas de mentira, sem gravar
     python3 whatsapp-conversa.py --sem-jev     publica sem o ramo do Jev em sombra (ver "Jev em sombra")
     python3 whatsapp-conversa.py --jev-tabela  cria a Data Table jev_sombra_respostas, se faltar
     python3 whatsapp-conversa.py --jev-exemplo imprime um item anônimo para testar o ramo do Jev no editor
"""
import json
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
PRUMO, PROSPECTS_GID = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U", "1838781376"
SITE, LEADS_GID = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o", "396728619"
SEGREDO = Path.home() / ".config/claude-ops/whatsapp-observador-segredo"
CREDENCIAL = "Observador WhatsApp"
COLUNAS_NOVAS = ["visto_em"]

# Ofertas do PRUMO além da consultoria (14/10/2026, PRUMO como holding; prumo-ofertas.py): abas Clínicas
# (Iris) e Estamparias (CRM de estamparia) na planilha do PRUMO, com o contrato de colunas do Prospects
# mais "Respondeu em". Lidas pelo NOME da aba (o gid nasceu no Dell, como no 08 · CRM) e tolerantes: aba
# que falta ou não lê vira item com "error" e é pulada, sem segurar o Site e o Prospects. Até 14/10 quem
# respondia ao convite delas era marcado à mão ("Em conversa" na Etapa).
OFERTAS_CFG = json.loads((Path(__file__).resolve().parent / "prumo-ofertas.json").read_text(encoding="utf-8"))["ofertas"]
# O que a conversa precisa de cada oferta além do JSON: o convite resumido para o Gemini (sem dado de
# ninguém) e o passo de quem respondeu com interesse, o mesmo que a Próxima ação do convite pede.
CONVERSA_DAS_OFERTAS = {
    "iris": {"o_que_foi": "Um convite de uma empresa (Prumo) que oferece o Iris, um sistema para clínicas de terapia em que as "
                          "anotações das sessões viram o dossiê da reavaliação para o convênio, perguntando se consegue falar com "
                          "quem coordena a clínica.",
             "interesse": "Combine a demonstração do dossiê (caso fictício, nunca dado de paciente)."},
    "estampa": {"o_que_foi": "Um convite de uma empresa (Prumo) sobre um jeito de organizar os pedidos de uma estamparia que chegam "
                             "pelo WhatsApp (arte, tamanhos e prazo numa ficha só), perguntando se consegue falar com o responsável.",
                "interesse": "Combine uma conversa de 20 minutos sobre como os pedidos chegam hoje."},
}
OFERTAS = [{"planilha": k, "aba": o["aba"], "no": "Ler " + o["aba"], "marcar": "Marcar em " + o["aba"], "rotulo": o["rotulo"],
            "convite": o["proxima_enviado"], **CONVERSA_DAS_OFERTAS[k]} for k, o in OFERTAS_CFG.items()]
# O que o fluxo marca (o "planilha" de cada item); "nenhuma" e o resto não batem em saída nenhuma do switch.
PLANILHAS = ["prumo", "site", *(o["planilha"] for o in OFERTAS)]
COLUNAS_MARCA_PRUMO = ["ID", "Etapa", "Convite enviado em", "Próxima ação"]
COLUNAS_MARCA_OFERTA = [*COLUNAS_MARCA_PRUMO, "Respondeu em"]

# Mesma regra do observador (observador.py, chave_do_numero).
CHAVE_JS = """const chave = (bruto) => {
  let d = String(bruto ?? '').replace(/\\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return '';
  return d.slice(0, 2) + d.slice(-8);
};
const numeroDoSite = (l) => String(l.wa_me ?? '').match(/wa\\.me\\/(\\d+)/)?.[1] ?? l.telefone ?? '';
const OFERTAS = """ + json.dumps(OFERTAS, ensure_ascii=False) + """;
// Leitura tolerante (ofertas): o item com "error" de uma aba que não leu não é lead.
const linhasDe = (no) => { try { return $(no).all().map(i => i.json ?? {}).filter(l => !l.error); } catch (e) { return []; } };"""

# Site: "recusado" entra no filtro para o envio do Rômulo poder retomar a conversa (30/09/2026).
MONTAR_JS = CHAVE_JS + """
const prumo = [{ no: 'Ler Prospects' }, ...OFERTAS].flatMap(f => linhasDe(f.no))
  .filter(l => !['Concluído', 'Sem interesse'].includes(String(l['Etapa'] ?? '').trim()))
  .map(l => chave(l['WhatsApp']));
const site = $('Ler Leads do site').all().map(i => i.json)
  .filter(l => ['novo', 'pronto', 'enviado', 'expirado', 'recusado'].includes(String(l.status ?? '').trim()))
  .map(l => chave(numeroDoSite(l)));
return [{ json: { chaves: [...new Set([...prumo, ...site].filter(Boolean))] } }];"""

DECIDIR_JS = CHAVE_JS + """
const ev = $('Conversa no WhatsApp').first().json.body ?? {};
const alvo = chave(ev.chave);
// saida: o Rômulo escreveu; entrada: o lead escreveu; lido: o lead leu (recibo azul). Outra coisa: nada.
const direcao = ['saida', 'entrada', 'lido'].includes(ev.direcao) ? ev.direcao : '';
// Segundo aviso do observador na mesma conversa: só serve ao Site (resposta depois da saudação).
const seguinte = ev.seguinte === true;
const recebido = ev.em ? new Date(ev.em) : new Date();
const em = Number.isFinite(recebido.getTime()) ? recebido : new Date();
// Saudação automática do WhatsApp Business chega segundos depois do envio; gente demora mais.
const SAUDACAO_MS = 5 * 60 * 1000;
const quando = em.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const txt = (v) => String(v ?? '').trim();
const CONVITE = 'Aguarde a resposta (do dono ou de quem atende o número). Quando aceitarem, faça o Raio-X e mande pelo botão da ficha no CRM. Sem resposta em 3 dias, um lembrete só.';
const saida = [];
// Prospects e as abas das ofertas (14/10/2026): a mesma regra. A oferta tem a coluna "Respondeu em",
// que o CRM lê antes da Próxima ação, e o seu próprio texto de convite (prumo-ofertas.json).
for (const f of [{ planilha: 'prumo', no: 'Ler Prospects', convite: CONVITE }, ...OFERTAS]) for (const l of linhasDe(f.no)) {
  if (!alvo || !direcao || seguinte || chave(l['WhatsApp']) !== alvo) continue;
  const etapa = txt(l['Etapa']);
  const oferta = f.planilha !== 'prumo';
  // O update grava todas as colunas mapeadas: "Respondeu em" vai sempre, com o valor de antes quando não muda.
  const respondeuAntes = txt(l['Respondeu em']);
  const base = { planilha: f.planilha, ID: String(l['ID']), nome: txt(l['Empresa']) || String(l['ID']), antes: etapa,
    ...(oferta ? { 'Respondeu em': respondeuAntes } : {}) };
  const respondeu = oferta ? { 'Respondeu em': respondeuAntes || em.toISOString() } : {};
  if (direcao === 'saida' && etapa === 'Revisar') {
    // O Rômulo escreveu ao prospect: vale o clique em "Enviar convite".
    saida.push({ json: { ...base, acao: 'abordou', 'Etapa': 'Convite enviado', 'Convite enviado em': em.toISOString(), 'Próxima ação': f.convite } });
  } else if (direcao === 'entrada' && etapa === 'Revisar') {
    // Resposta prova que o contato aconteceu, mesmo sem o link rastreado.
    saida.push({ json: { ...base, acao: 'respondeu', 'Etapa': 'Convite enviado', 'Convite enviado em': em.toISOString(),
      'Próxima ação': 'Respondeu no WhatsApp em ' + quando + '. Continue a conversa.', ...respondeu } });
  } else if (direcao === 'entrada' && etapa === 'Convite enviado') {
    // 05/10/2026: a regra dos 5 min do Site vale aqui também. Até então toda saudação automática
    // virava "Respondeu no WhatsApp" (05/10: pares de "respostas" no mesmo minuto do lote de convites).
    const desde = Date.parse(txt(l['Convite enviado em']));
    if (Number.isFinite(desde) && em.getTime() - desde < SAUDACAO_MS) continue;
    // Reescreve a data do convite com ela mesma: o update grava todas as colunas mapeadas.
    saida.push({ json: { ...base, acao: 'respondeu', 'Etapa': etapa, 'Convite enviado em': String(l['Convite enviado em'] ?? ''),
      'Próxima ação': 'Respondeu no WhatsApp em ' + quando + '. Continue a conversa.', ...respondeu } });
  } else if (direcao === 'lido' && etapa === 'Convite enviado' && !/^(Respondeu|Leu)/.test(txt(l['Próxima ação']))) {
    // Primeira leitura depois do convite; "Respondeu" vale mais e não é sobrescrito.
    saida.push({ json: { ...base, acao: 'leu', 'Etapa': etapa, 'Convite enviado em': String(l['Convite enviado em'] ?? ''),
      'Próxima ação': 'Leu o convite em ' + quando + '. Sem resposta em 3 dias, '
        + (oferta ? 'um lembrete só.' : 'ofereça fazer por telefone.') } });
  }
}
for (const l of $('Ler Leads do site').all().map(i => i.json)) {
  if (!alvo || !direcao || chave(numeroDoSite(l)) !== alvo) continue;
  const status = txt(l.status);
  const enviadoAntes = txt(l.enviado_em);
  const respondeuAntes = txt(l.respondeu_em);
  const vistoAntes = txt(l.visto_em);
  // O update grava todas as colunas mapeadas: o que não muda vai com o valor de antes.
  const base = { planilha: 'site', place_id: String(l.place_id), nome: txt(l.nome) || String(l.place_id), antes: status,
    status, enviado_em: enviadoAntes, respondeu_em: respondeuAntes, visto_em: vistoAntes, mensagem_variante: txt(l.mensagem_variante) };
  // "novo" com site publicado: o Rômulo manda a demo assim que o Hermes avisa, antes de o Balcão passar.
  const aEnviar = status === 'novo' || status === 'pronto';
  // 07/10/2026: lead que vira "enviado" aqui saiu sem o clique no wa_link (o clique já marca
  // "enviado"). O texto foi o que o Rômulo escreveu ou colou, não a variação que o Balcão
  // gravou em mensagem_variante: o funil não pode creditá-lo à variação.
  const MANUAL = { mensagem_variante: 'manual' };
  if (direcao === 'saida') {
    // Enviado e fechado: conversa normal. Recusado/expirado: retomou, e o acompanhamento conta de novo.
    if (aEnviar) saida.push({ json: { ...base, acao: 'abordou', status: 'enviado', enviado_em: em.toISOString(), ...MANUAL } });
    else if (status === 'recusado' || status === 'expirado') {
      saida.push({ json: { ...base, acao: 'retomou', status: 'enviado', enviado_em: em.toISOString() } });
    }
    continue;
  }
  if (direcao === 'lido') {
    // Só a primeira leitura. Lido em novo/pronto prova um envio que passou batido.
    if (vistoAntes || !['novo', 'pronto', 'enviado', 'expirado', 'recusado'].includes(status)) continue;
    saida.push({ json: { ...base, acao: 'leu', visto_em: em.toISOString(),
      ...(aEnviar ? { status: 'enviado', enviado_em: enviadoAntes || em.toISOString(), ...MANUAL } : {}) } });
    continue;
  }
  if (!['novo', 'pronto', 'enviado', 'expirado'].includes(status)) continue;
  // Resposta: prova que o site chegou ao lead.
  const enviado = enviadoAntes || (aEnviar ? em.toISOString() : '');
  // Enviado sem data legível (marcado à mão) conta como envio antigo.
  const desde = Date.parse(enviado);
  const longe = !Number.isFinite(desde) || em.getTime() - desde >= SAUDACAO_MS;
  const respondeu = respondeuAntes || (longe ? em.toISOString() : '');
  const novoStatus = aEnviar || (status === 'expirado' && respondeu) ? 'enviado' : status;
  if (novoStatus === status && enviado === enviadoAntes && respondeu === respondeuAntes) continue;
  saida.push({ json: { ...base, acao: 'respondeu', status: novoStatus, enviado_em: enviado, respondeu_em: respondeu,
    ...(aEnviar ? MANUAL : {}) } });
}
// Sempre um item, para a resposta ao observador sair; "nenhuma" não bate em nenhuma saída do switch.
return saida.length ? saida : [{ json: { planilha: 'nenhuma' } }];"""

# Resposta ao observador (expressão do nó "Responder ao observador").
RESPOSTA_JS = ("{ ok: true, marcados: $input.all().filter(i => " + json.dumps(PLANILHAS) + ".includes(i.json.planilha))"
               ".map(i => ({ planilha: i.json.planilha, nome: i.json.nome, acao: i.json.acao, antes: i.json.antes })) }")


# ---------------------------------------------------------------- texto das respostas (05/10/2026)
#
# POST /webhook/whatsapp-resposta {"chave", "mensagens": [{"em", "texto", "papel"?}], "contexto"?}: o observador junta o que
# um lead escreveu (remendo squadone:respostas da bridge) e manda aqui. O Gemini classifica:
#   bot       só mensagem automática (saudação, ausência, menu, catálogo): não é resposta. Apaga o
#             respondeu_em que a regra dos 5 min tenha posto nesta conversa e o lead volta a Contatado,
#             com follow-up e expiração de sempre. Nunca apaga uma classificação de gente.
#   negativa  gente recusou: Site -> "recusado" (como o botão Recusou, com status_anterior e o pacote
#             que leva a pasta para _recusados/); PRUMO -> Etapa "Sem interesse". Sai do funil.
#   exclusao  (07/10/2026) gente pediu para apagar o site, o demo ou o conteúdo. Para o funil é uma
#             negativa (sai igual); a mais, o aviso propõe apagar o demo com o comando
#             `site-demos-limpeza --exclusao demo-<slug>`. Nada é apagado aqui: mensagem recebida
#             propõe, não escreve (RULES 10); quem apaga é o Rômulo, rodando o comando. Caso que
#             trouxe o tipo (Baby School, 07/10): "Na verdade hoje já temos uma agência, fiquei
#             curioso mesmo para ver o resultado, de qualquer forma agradeço, se puder excluir esse
#             conteúdo por gentileza".
#   interesse gente quer ver: respondeu_em; o aviso traz o link da segunda mensagem (Site: o site;
#             PRUMO: a ficha do CRM, para fazer e mandar o Raio-X).
#   licenca   (17/10/2026) gente só deu licença para o Rômulo mandar o que ELE ofereceu ("posso mandar o
#             vídeo? sem compromisso" -> "claro, pode enviar sim"): respondeu_em como o interesse, o aviso
#             manda enviar o material (Site: o link da segunda mensagem; PRUMO e ofertas: a ficha), mas o tipo
#             gravado é "licenca", não "interesse": ainda não se sabe se ele quer o produto. Caso que trouxe o
#             tipo: esse "sim" foi gravado como interesse porque o Gemini não via a pergunta do Rômulo.
#   neutra    gente respondeu sem sim nem não: respondeu_em; continue a conversa.
#
# Desde 17/10/2026 o observador manda também `papel` em cada mensagem (recepcao/robo, pela marca no texto) e
# `contexto` {saidas, anteriores}: as últimas 3 mensagens do Rômulo e as últimas 3 do lead antes do lote, da
# conversa em disco. O prompt as mostra como contexto. Áudio chega como "[áudio 27s] <transcrição>" ou só
# "[áudio 27s]" (ninguém ouviu). Regras que não dependem do modelo, em "Decidir pela resposta": lote só de áudio
# sem transcrição = neutra (e não sobrescreve resposta de gente); lote só de robô não vira interesse nem licença
# (a recepção, desde a revisão de 17/10/2026, fica com o modelo: é gente); neutra não apaga uma negativa ou
# exclusão anterior. As regras moram em TIPO_FINAL_JS, que o ramo do Jev também usa para o tipo_final.
# Grava o tipo e o trecho na planilha (Site: resposta_tipo, resposta_trecho, resposta_em; PRUMO:
# "Tipo da resposta", "Resposta", "Resposta em") e responde ao observador com o aviso de cada lead
# (gente, não bot), que vai ao Rômulo pelo Hermes. O texto inteiro não é guardado: só o trecho.
# Gente que responde a quem ainda estava "novo"/"pronto" prova um envio sem o clique no wa_link:
# mensagem_variante "manual", como no fluxo da conversa.

LINKS = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook"
# A ficha do lead na Central (Serve da tailnet, porta 8443): o aviso de interesse do PRUMO leva para lá.
CRM = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/crm"
GEMINI_MODELO = "models/gemini-3.6-flash"  # o mesmo do Caçador
TIPOS_HUMANOS = ("negativa", "exclusao", "interesse", "licenca", "neutra")
COLUNAS_RESPOSTA_SITE = ["resposta_tipo", "resposta_trecho", "resposta_em"]
COLUNAS_RESPOSTA_PRUMO = ["Tipo da resposta", "Resposta", "Resposta em"]

MONTAR_RESPOSTA_JS = CHAVE_JS + """
const ev = $('Resposta no WhatsApp').first().json.body ?? {};
const alvo = chave(ev.chave);
const txt = (v) => String(v ?? '').trim();
// papel (17/10/2026): o observador marca "*[Nome]* ..." como recepção e "[Atendimento] ..." como robô; sem marca, gente.
const PAPEIS = { robo: 'robô', recepcao: 'recepção' };
const papelDe = (m) => (Object.prototype.hasOwnProperty.call(PAPEIS, m?.papel) ? m.papel : '');
const mensagens = (Array.isArray(ev.mensagens) ? ev.mensagens : [])
  .map(m => ({ em: txt(m?.em), texto: txt(m?.texto).slice(0, 1000), ...(papelDe(m) ? { papel: papelDe(m) } : {}) }))
  .filter(m => m.texto).slice(0, 20);
// contexto (17/10/2026): as últimas 3 mensagens do Rômulo e as 3 do negócio antes destas, da conversa em disco.
// Sem ele o "Claro, pode enviar sim" a "posso mandar o vídeo? Sem compromisso" virou interesse.
const ctx = ev.contexto && typeof ev.contexto === 'object' ? ev.contexto : {};
const doContexto = (lista, quem) => (Array.isArray(lista) ? lista.slice(-3) : [])
  .map(x => ({ em: txt(x?.em), texto: txt(x?.texto).slice(0, 500), quem, papel: papelDe(x) })).filter(x => x.texto);
const antes = [...doContexto(ctx.saidas, 'Rômulo'), ...doContexto(ctx.anteriores, 'negócio')]
  .sort((a, b) => (Date.parse(a.em) || 0) - (Date.parse(b.em) || 0));
const marca = (p) => (p ? ' (' + PAPEIS[p] + ')' : '');
const dataHora = (em) => {
  const d = new Date(em);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?';
};
const achados = [];
for (const f of [{ planilha: 'prumo', no: 'Ler Prospects' }, ...OFERTAS]) for (const l of linhasDe(f.no)) {
  if (alvo && mensagens.length && chave(l['WhatsApp']) === alvo && txt(l['Etapa']) !== 'Concluído') {
    achados.push({ planilha: f.planilha, linha: l, enviado: txt(l['Convite enviado em']) });
  }
}
for (const l of $('Ler Leads do site').all().map(i => i.json)) {
  if (alvo && mensagens.length && chave(numeroDoSite(l)) === alvo
      && ['novo', 'pronto', 'enviado', 'expirado', 'recusado'].includes(txt(l.status))) {
    achados.push({ planilha: 'site', linha: l, enviado: txt(l.enviado_em) });
  }
}
const O_QUE_FOI = {
  site: 'Uma mensagem oferecendo um site de demonstração que ele montou de graça para o negócio, perguntando se pode mandar o link.',
  prumo: 'Um convite de uma consultoria (Prumo) que ajuda donos de empresa a passar decisões do dia a dia para a equipe, perguntando se consegue falar com o responsável.',
  ...Object.fromEntries(OFERTAS.map(o => [o.planilha, o.o_que_foi])),
};
const primeiro = achados[0];
const desde = Date.parse(primeiro?.enviado ?? '');
const depois = (em) => {
  const s = Math.round((Date.parse(em) - desde) / 1000);
  if (!Number.isFinite(s)) return '?';
  return s < 120 ? s + ' s' : s < 7200 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h';
};
// 17/10/2026: o tipo "licenca", o contexto, o papel, o áudio e as recusas educadas (ver a lista de tipos no topo).
const prompt = !primeiro ? '' : [
  'O Rômulo mandou, pelo WhatsApp, uma mensagem de prospecção a um negócio que não o conhece.',
  'O que ele mandou primeiro: ' + O_QUE_FOI[primeiro.planilha],
  ...(antes.length ? [
    '',
    'Conversa ANTES das mensagens a classificar (só contexto, na ordem; não classifique estas):',
    ...antes.map(x => '- ' + dataHora(x.em) + ' ' + x.quem + marca(x.papel) + ': ' + JSON.stringify(x.texto)),
  ] : []),
  '',
  'Mensagens a classificar, que chegaram do número do negócio, na ordem (tempo desde o envio entre colchetes;',
  '"(robô)" ou "(recepção)" quando o próprio texto traz a marca de um atendimento automático ou da assinatura de uma recepção):',
  ...mensagens.map(m => '- [' + depois(m.em) + ']' + marca(m.papel) + ' ' + JSON.stringify(m.texto)),
  '',
  'Áudio: "[áudio 27s]" sozinho é um áudio que ninguém ouviu (sem transcrição); "[áudio 27s] texto" é o áudio com a',
  'transcrição, e vale o texto.',
  '',
  'Classifique a conversa em um tipo:',
  '- "bot": só mensagens automáticas (saudação ou ausência do WhatsApp Business, horário de atendimento, menu "digite 1",',
  '  "recebemos sua mensagem, em breve retornaremos", link de catálogo, cardápio ou agendamento), sem nenhuma frase escrita',
  '  por uma pessoa em resposta ao que o Rômulo disse. Mensagem que chega segundos depois do envio quase sempre é automática.',
  '  Mensagem marcada "(robô)" é automática.',
  '- "exclusao": uma pessoa pediu para apagar, excluir, remover ou tirar do ar o site, a demonstração, as fotos',
  '  ou o conteúdo: "pode apagar", "se puder excluir esse conteúdo", "tira do ar", "não autorizo usar nossas fotos".',
  '  Vale mesmo que agradeça, elogie ou também recuse ("já temos agência, agradeço, mas exclua por favor").',
  '- "negativa": uma pessoa recusou: "não tenho interesse", "já temos site", "não precisamos", "não, obrigado",',
  '  "agradeço, mas no momento não", "no momento não temos interesse", "agora não dá", pediu para não mandar mais,',
  '  reclamou de spam, disse que é número errado, ou foi hostil (sem pedir para apagar nada).',
  '  Recusa educada continua sendo recusa: agradecer ou elogiar não a transforma em interesse.',
  '- "licenca": uma pessoa só deu licença para o Rômulo mandar algo que ELE ofereceu (o vídeo, o link, o PDF, o site):',
  '  a última mensagem do Rômulo pedia licença ("posso te mandar o vídeo?", "posso enviar o link?", "sem compromisso")',
  '  e a resposta é "pode", "pode mandar", "claro, pode enviar sim", "manda aí", "ok, pode". Se a primeira mensagem do',
  '  Rômulo já perguntava se podia mandar algo, "pode mandar" também é "licenca". Licença não é interesse: ainda não se',
  '  sabe se a pessoa quer o produto.',
  '- "interesse": uma pessoa quer o que foi oferecido ou quer saber mais: "quanto custa?", "como funciona?", "gostei",',
  '  "quero", "tenho interesse", "me explica melhor", "sou eu, pode falar", ou aceitou a proposta.',
  '- "neutra": uma pessoa respondeu sem sim nem não ("quem é?", "do que se trata?", "vou passar para o dono", "ok"),',
  '  "qualquer coisa eu aviso", "vou passar para o responsável e retornamos", ou não dá para saber.',
  '',
  'Regras de desempate:',
  '- Se houver mensagem automática e mensagem de pessoa, decida pela de pessoa; se a pessoa mudou de ideia, pela última.',
  '- Pedido para apagar ou excluir vence a recusa: é "exclusao", nunca "negativa".',
  '- "[áudio Ns]" sem texto: não se sabe o que foi dito. Nunca é "bot" nem "interesse"; sozinho, é "neutra".',
  '- Mensagem marcada "(robô)" é o atendimento automático: nunca é "interesse" nem "licenca" sozinha.',
  '- Mensagem marcada "(recepção)" é de gente que atende pelo negócio: classifique pelo que ela diz, como a de qualquer',
  '  pessoa ("pode enviar sim" a um pedido de licença é "licenca"; "quanto custa?" é "interesse").',
  '- Se a conversa anterior tem uma recusa do negócio, um "ok", "obrigado" ou outra resposta neutra depois NÃO a desfaz:',
  '  continua "negativa", a menos que a pessoa diga claramente que mudou de ideia ("pensando bem, pode mandar", "quero sim").',
  '- Recusa educada ou adiamento ("qualquer coisa eu aviso", "vou ver e retorno") nunca é "interesse".',
  '',
  'Responda só com JSON, sem texto em volta:',
  '{"tipo": "bot|exclusao|negativa|licenca|interesse|neutra", "trecho": "a frase da pessoa que decidiu, literal, até 160 caracteres (vazio se bot)", "motivo": "até 12 palavras"}',
].join('\\n');
return [{ json: { tem: achados.length > 0, achados, mensagens, prompt } }];"""

# As regras do tipo que não dependem do modelo (17/10/2026), num lugar só: "Decidir pela resposta" grava o tipo
# que sai daqui e o ramo do Jev o registra ao lado do bruto (tipo_final), para a medição saber o que foi gravado.
TIPO_FINAL_JS = """
// - só áudio que ninguém ouviu ("[áudio 27s]" sem transcrição): não se sabe o que foi dito; nunca bot nem interesse.
// - só mensagens do robô: nunca viram interesse nem licença. A recepção (revisão de 17/10/2026) fica com o
//   modelo: é gente, e rebaixá-la apagava interesse de verdade dito por quem atende ("quanto custa?").
const SO_AUDIO = /^\\[áudio( \\d+s)?\\]$/;
const soAudioDe = (mensagens) => mensagens.length > 0 && mensagens.every(x => SO_AUDIO.test(String(x?.texto ?? '').trim()));
const tipoFinalDe = (tipo, mensagens) => {
  if (soAudioDe(mensagens)) return 'neutra';
  const soRobo = mensagens.length > 0 && mensagens.every(x => x?.papel === 'robo');
  return soRobo && (tipo === 'interesse' || tipo === 'licenca') ? 'neutra' : tipo;
};
"""

DECIDIR_RESPOSTA_JS = CHAVE_JS + TIPO_FINAL_JS + """
const m = $('Montar pergunta').first().json;
const g = $('Gemini: classificar resposta').first().json ?? {};
const bruto = String(g.content?.parts?.map(p => p.text ?? '').join('') ?? g.text ?? g.output ?? '');
let r = {};
try { r = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1)); } catch (e) { r = {}; }
const HUMANOS = ['negativa', 'exclusao', 'interesse', 'licenca', 'neutra'];
// Resposta ilegível do modelo: "neutra" (gente, sem decidir nada sozinho) em vez de tirar alguém do funil.
let tipo = ['bot', ...HUMANOS].includes(r.tipo) ? r.tipo : 'neutra';
// As regras que não dependem do modelo (TIPO_FINAL_JS): só áudio sem transcrição e só robô viram neutra.
const soAudio = soAudioDe(m.mensagens);
tipo = tipoFinalDe(tipo, m.mensagens);
// Pedido de exclusão: o demo só sai pelo comando do Rômulo (RULES 10). O comando confere o pedido no
// retrato da planilha (site-leads.json), que o fluxo 07 grava de hora em hora aos :20.
const RETRATO_DEPOIS = (() => {
  const r = new Date(Date.now() + 60 * 1000);
  const t = new Date(r);
  t.setUTCMinutes(21, 0, 0);  // São Paulo é UTC-3 em hora cheia: :21 lá é :21 aqui
  if (t <= r) t.setTime(t.getTime() + 60 * 60 * 1000);
  return t.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
})();
const txt = (v) => String(v ?? '').trim();
const ultima = m.mensagens[m.mensagens.length - 1] ?? { em: new Date().toISOString(), texto: '' };
const trecho = tipo === 'bot' ? '' : (txt(r.trecho) || ultima.texto).replace(/\\s+/g, ' ').slice(0, 200);
const agora = new Date().toISOString();
const primeiraEm = m.mensagens[0]?.em || ultima.em;
const quando = new Date(ultima.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const ROTULO = { site: 'Site antes da venda', prumo: 'PRUMO', ...Object.fromEntries(OFERTAS.map(o => [o.planilha, o.rotulo])) };
const OFERTA = Object.fromEntries(OFERTAS.map(o => [o.planilha, o]));
const aspas = (t) => '\\u201c' + t + '\\u201d';
const saida = [];
for (const a of m.achados) {
  const l = a.linha;
  const tipoAntes = txt(a.planilha === 'site' ? l.resposta_tipo : l['Tipo da resposta']);
  // Robô depois de gente (lembrete respondido pela saudação automática) não apaga o que a pessoa disse.
  if (tipo === 'bot' && HUMANOS.includes(tipoAntes)) continue;
  // 17/10/2026: uma recusa não é apagada por uma resposta neutra depois ("ok", "obrigado", um áudio que ninguém
  // ouviu); mudar de ideia de verdade vem como licenca ou interesse. E um áudio sem transcrição depois de qualquer
  // resposta de gente não traz nada novo para gravar.
  if (tipo === 'neutra' && ['negativa', 'exclusao'].includes(tipoAntes)) continue;
  if (soAudio && HUMANOS.includes(tipoAntes)) continue;
  const nome = txt(a.planilha === 'site' ? l.nome : l['Empresa']) || 'lead';
  const cab = '\\ud83d\\udcac ' + nome + ' (' + ROTULO[a.planilha] + ') respondeu: ' + aspas(trecho) + '\\n\\u2192 ';
  // O que fazer com um áudio que ninguém ouviu (a transcrição falhou ou não houve): ouvir no WhatsApp.
  const OUVIR = 'Mandou um áudio que não foi transcrito: ouça no WhatsApp e continue a conversa';
  // Licença (17/10/2026): o "pode mandar" autorizou o material que o Rômulo ofereceu; ainda não é interesse.
  const LICENCA = 'Licença para mandar (ainda não é interesse): mande o que você ofereceu';
  if (a.planilha === 'site') {
    const status = txt(l.status);
    const respondeuAntes = txt(l.respondeu_em);
    const item = { planilha: 'site', nome, tipo, place_id: String(l.place_id), status, status_anterior: txt(l.status_anterior),
      recusado_em: txt(l.recusado_em), respondeu_em: respondeuAntes, resposta_tipo: tipo, resposta_trecho: trecho, resposta_em: ultima.em,
      mensagem_variante: txt(l.mensagem_variante) };
    if (tipo === 'bot') {
      // A regra dos 5 min pode ter marcado a saudação como resposta: só o respondeu_em desta conversa sai.
      const t = Date.parse(respondeuAntes);
      if (Number.isFinite(t) && t >= Date.parse(primeiraEm) - 10 * 60 * 1000) item.respondeu_em = '';
    } else {
      item.respondeu_em = respondeuAntes || ultima.em;
      if (['novo', 'pronto', 'expirado'].includes(status)) item.status = 'enviado';
      // Ainda "novo"/"pronto": o envio saiu sem o clique no wa_link (que já marca "enviado").
      if (['novo', 'pronto'].includes(status)) item.mensagem_variante = 'manual';
    }
    const recusar = () => Object.assign(item, {
      // Igual ao botão Recusou da página do lead: o Desfazer de lá devolve status_anterior.
      status: 'recusado', status_anterior: status === 'expirado' ? 'enviado' : status, recusado_em: agora,
      pacote: { place_id: String(l.place_id), acao: 'recusou', nome, em: agora, status: 'recusado' } });
    const desfazer = 'Se foi engano, desfaça na página do lead: ' + (txt(l.acoes_link) || 'planilha');
    if (tipo === 'exclusao') {
      // Conta como negativa; a mais, a proposta de apagar o demo (só pelo comando, nunca sozinho).
      if (status !== 'recusado') recusar();
      const projeto = txt(l.vercel_project);
      item.aviso = cab + 'Pediu para apagar o demo' + (status !== 'recusado' ? ': saiu do funil (Recusou).' : '.') + ' Nada foi apagado. '
        + (/^demo-[a-z0-9._-]+$/.test(projeto)
          ? 'Para apagar, no Dell, a partir das ' + RETRATO_DEPOIS + ': site-demos-limpeza --exclusao ' + projeto
          : 'A planilha não diz o projeto demo-* da Vercel: confira no publicado.json da pasta e apague à mão.')
        + '\\n' + desfazer;
    } else if (tipo === 'negativa' && status !== 'recusado') {
      recusar();
      item.aviso = cab + 'Negativa: saiu do funil (Recusou). ' + desfazer;
    } else if (tipo === 'interesse') {
      const s = segundaDe(l);
      // 14/10/2026 (demo sob pedido): sem demo, a segunda é o raio-x avulso; o demo sai pelo "Gerar demo" da ficha.
      const so = s.texto.indexOf('Aqui está o raio-x') === 0 && !txt(l.site_url);
      item.aviso = cab + (so ? 'Interesse! Mande o raio-x' : 'Interesse! Mande o link do site')
        + (s.link ? ': ' + s.link : (s.numero ? ' (sem demo nem raio-x na linha).' : ' (sem WhatsApp na linha).'))
        + (so ? ' Se ele quiser o site, toque "Gerar demo" na ficha do CRM.' : '');
    } else if (tipo === 'licenca') {
      const s = segundaDe(l);
      item.aviso = cab + LICENCA + (s.link ? ': ' + s.link : (s.numero ? ' (sem demo nem raio-x na linha).' : ' (sem WhatsApp na linha).'));
    } else if (tipo === 'neutra') {
      const n = numeroDoLead(l);
      item.aviso = cab + (soAudio ? OUVIR : 'Gente, sem sim nem não: continue a conversa') + (n ? ': https://wa.me/' + n : '.');
    }
    if (status === 'recusado' && !['negativa', 'exclusao'].includes(tipo) && item.aviso) item.aviso += '\\n(Estava como Recusou; se mudou de ideia, desfaça na página do lead.)';
    saida.push({ json: item });
  } else {
    // PRUMO (Prospects) e as ofertas (Clínicas, Estamparias: 14/10/2026), com o mesmo contrato de colunas.
    const oferta = OFERTA[a.planilha];
    const etapa = txt(l['Etapa']);
    const respondeuAntes = txt(l['Respondeu em']);
    const item = { planilha: a.planilha, nome, tipo, ID: String(l['ID']), 'Etapa': etapa,
      'Convite enviado em': txt(l['Convite enviado em']), 'Próxima ação': txt(l['Próxima ação']),
      'Tipo da resposta': tipo, 'Resposta': trecho, 'Resposta em': ultima.em,
      ...(oferta ? { 'Respondeu em': respondeuAntes } : {}) };
    // 09/10/2026: o "sim" recebe o Raio-X (feito à mão, dados públicos), não o formulário de 16 perguntas
    // (passo=diagnostico), que saiu com o plano de 08/10. O aviso leva à ficha, onde fica a mensagem pronta.
    const ficha = '""" + CRM + """?ver=funil&lead=' + encodeURIComponent(a.planilha + ':' + String(l['ID']));
    if (etapa === 'Revisar') Object.assign(item, { 'Etapa': 'Convite enviado', 'Convite enviado em': item['Convite enviado em'] || primeiraEm });
    if (oferta && tipo !== 'bot') {
      // Gente respondeu: a oferta ganha "Respondeu em" (a regra dos 5 min pode já ter posto) e, se ainda
      // estava no convite, a Etapa "Em conversa", que até 14/10 era marcada à mão. A negativa sai abaixo.
      item['Respondeu em'] = respondeuAntes || ultima.em;
      if (item['Etapa'] === 'Convite enviado') item['Etapa'] = 'Em conversa';
    }
    if (tipo === 'bot') {
      // O CRM lê "Respondeu no WhatsApp em ..." da Próxima ação: só a saudação, isso sai.
      if (/^Respondeu/.test(item['Próxima ação']) && !HUMANOS.includes(tipoAntes)) {
        item['Próxima ação'] = 'Só resposta automática em ' + quando + '. Sem resposta de gente em 3 dias, um lembrete só.';
      }
      // Na oferta o CRM lê antes "Respondeu em": a da saudação (desta conversa) sai, como o respondeu_em do Site.
      const t = Date.parse(respondeuAntes);
      if (oferta && Number.isFinite(t) && t >= Date.parse(primeiraEm) - 10 * 60 * 1000) item['Respondeu em'] = '';
    } else if (tipo === 'negativa') {
      Object.assign(item, { 'Etapa': 'Sem interesse', 'Próxima ação': 'Recusou no WhatsApp em ' + quando + ': ' + aspas(trecho) });
      item.aviso = cab + 'Negativa: saiu do funil (Sem interesse). Se foi engano, volte a Etapa na planilha.';
    } else if (tipo === 'exclusao') {
      // O PRUMO não tem demo: sai do funil como a negativa, e o que for dele se apaga à mão.
      Object.assign(item, { 'Etapa': 'Sem interesse',
        'Próxima ação': 'Pediu exclusão no WhatsApp em ' + quando + ': ' + aspas(trecho) + '. Apague o que for dele (nada é apagado sozinho).' });
      item.aviso = cab + 'Pediu para apagar os dados: saiu do funil (Sem interesse). Nada foi apagado; o que for dele está na planilha do PRUMO'
        + (oferta ? ' (aba ' + oferta.aba + ').' : '.');
    } else if (tipo === 'interesse') {
      // Ofertas: sem Raio-X nem texto de 2º passo aprovado; o passo é combinar a demonstração (prumo-ofertas.json).
      item['Próxima ação'] = 'Respondeu no WhatsApp em ' + quando + ' (interesse): ' + aspas(trecho) + '. '
        + (oferta ? oferta.interesse : 'Faça o Raio-X e mande (botão na ficha do CRM).');
      item.aviso = cab + (oferta ? 'Interesse! ' + oferta.interesse + ' Ficha: ' : 'Interesse! Faça o Raio-X e mande pela ficha: ') + ficha;
    } else if (tipo === 'licenca') {
      item['Próxima ação'] = 'Respondeu no WhatsApp em ' + quando + ' (licença para mandar): ' + aspas(trecho)
        + '. Mande o que você ofereceu; interesse só quando ele reagir ao material.';
      item.aviso = cab + LICENCA + '. Ficha: ' + ficha;
    } else {
      item['Próxima ação'] = 'Respondeu no WhatsApp em ' + quando + ': ' + aspas(trecho) + '. '
        + (soAudio ? 'Áudio não transcrito: ouça no WhatsApp.' : 'Continue a conversa.');
      item.aviso = cab + (soAudio ? OUVIR + '.' : 'Gente, sem sim nem não: continue a conversa.');
    }
    saida.push({ json: item });
  }
}
return saida.length ? saida : [{ json: { planilha: 'nenhuma' } }];"""

RESPOSTA_CLASSIFICADA_JS = ("{ ok: true, marcados: $input.all().filter(i => " + json.dumps(PLANILHAS) + ".includes(i.json.planilha))"
                            ".map(i => ({ planilha: i.json.planilha, nome: i.json.nome, tipo: i.json.tipo,"
                            " ...(i.json.aviso ? { aviso: i.json.aviso } : {}) })) }")

PACOTE_JS = """// Pacote para o site-pastas do Dell (o n8n não move diretórios), como o botão Recusou.
return $input.all().filter(i => i.json.pacote).map(i => {
  const nome = Date.now() + '-' + String(i.json.pacote.place_id).replace(/[^a-zA-Z0-9_-]+/g, '_') + '.json';
  return { json: { nome }, binary: { data: { data: Buffer.from(JSON.stringify(i.json.pacote), 'utf8').toString('base64'),
    mimeType: 'application/json', fileName: nome } } };
});"""


# ---------------------------------------------------------------- Jev em sombra (11/10/2026)
#
# O Rômulo autorizou medir o Jev (typesafe/jev-1.13, da TypeSafe, pela Decisions API da OpenRouter) na
# classificação das respostas, EM SOMBRA: o Jev nunca decide. O ramo sai de "Decidir pela resposta" em
# paralelo e roda depois do ramo de sempre (execução v1: ramo de cima primeiro, e os nós do Jev ficam
# embaixo no canvas); nada dele volta ao observador nem à planilha, e toda falha dele (máscara, HTTP,
# tabela) termina sem registro, nunca em erro do fluxo.
#
# Privacidade (dados de terceiros brasileiros, processamento nos EUA, sem DPA da TypeSafe): vai ao Jev só
# o texto da ÚLTIMA mensagem do lead, mascarado ANTES do envio e cortado em 600 caracteres. Não vão o
# histórico, o cabeçalho da conversa, o nome do lead, o nome da empresa, o telefone, o chat id nem o
# place_id/ID. Texto que fica vazio (ou só rótulos) depois da máscara não sai. Cada pedido leva
# provider {zdr: true, data_collection: 'deny'}. Mascarar NÃO é anonimizar: nome próprio que não está na
# planilha ("sou a Jackeline"), endereço e contexto passam. A tabela da sombra fica no n8n da Mel e guarda
# o lead só como sha256(sal + chave), nunca o telefone nem o place_id; o vínculo com o lead só se refaz do
# lado do Rômulo (jev-respostas-resumo.py, que lê o crm.json local). Como o sal é fixo e está no repositório
# e a chave tem só 10 dígitos, o hash é pseudônimo, não anônimo: por isso ele nunca sai da Mel.
#
# Ligar: credencial de cabeçalho "OpenRouter Jev" e Data Table "jev_sombra_respostas" no n8n, e republicar
# (python3 whatsapp-conversa.py). Sem a credencial, o fluxo sai sem o ramo. Desligar: --sem-jev, ou
# desativar o nó "Jev: classificar (sombra)" no editor. Resumo e regra de promoção: jev-respostas-resumo.py.

JEV_CREDENCIAL = "OpenRouter Jev"
JEV_TABELA = "jev_sombra_respostas"
JEV_URL = "https://openrouter.ai/api/alpha/decisions"
JEV_MODELO = "typesafe/jev-1.13"
# Sal fixo do fluxo (o mesmo em jev-respostas-resumo.py, conferido no --testar).
JEV_SAL = "squadone:jev-sombra:v1"
JEV_LIMITE = 600
# Colunas da Data Table (nome, tipo). revisao_humana o fluxo nunca preenche: é o Rômulo, no editor do n8n.
JEV_COLUNAS = [("lead_hash", "string"), ("planilha", "string"), ("n_mensagens", "number"), ("resposta_em", "string"),
               ("tipo_gemini", "string"), ("jev_choice", "string"), ("jev_probabilities", "string"),
               ("jev_confidence", "number"), ("jev_injecao", "number"), ("jev_model", "string"),
               ("input_tokens", "number"), ("output_tokens", "number"), ("cost", "number"), ("latencia_ms", "number"),
               ("em", "string"), ("revisao_humana", "string"),
               # 17/10/2026: o tipo depois das regras sem modelo (só áudio, só robô). Tabela criada antes não a tem:
               # o fluxo só a grava quando a tabela tem a coluna (jev_tabela_tem_tipo_final).
               ("tipo_final", "string")]

# Funções PURAS (sem $, sem rede, sem relógio): a máscara, o hash e o pedido. Testadas no node (--testar).
JEV_FUNCOES_JS = r"""
const JEV = { modelo: '""" + JEV_MODELO + r"""', limite: """ + str(JEV_LIMITE) + r""", sal: '""" + JEV_SAL + r"""' };
const ROTULOS = /\[(TEL|EMAIL|DOC|URL|SEGREDO|NOME|EMPRESA)\]/g;
// Colunas que, quando existem na linha do lead, trazem o nome de uma pessoa.
const COLUNAS_DE_PESSOA = ['Contato', 'Responsável', 'Responsavel', 'Dono', 'contato', 'responsavel', 'dono', 'nome_contato'];
// Palavras de nome de empresa que não identificam ninguém, e palavras curtas comuns nas respostas:
// mascará-las só tiraria sentido do texto ("Bom Preço" não pode apagar o "bom" de "bom dia").
const GENERICAS = new Set(['ltda', 'eireli', 'comercio', 'servicos', 'industria', 'grupo', 'empresa', 'loja', 'casa', 'centro',
  'clinica', 'studio', 'estudio', 'escola', 'padaria', 'oficina', 'restaurante', 'academia', 'salao', 'pilates', 'odontologia',
  'contabilidade', 'consultoria', 'distribuidora', 'para', 'com', 'sim', 'nao', 'boa', 'bom', 'dia', 'ola', 'que', 'pra',
  'por', 'sem', 'mas', 'sou', 'ele', 'ela', 'seu', 'sua', 'meu', 'nos', 'ate', 'tem', 'ter', 'ver', 'vai', 'foi', 'ser',
  'uma', 'uns', 'dos', 'das', 'aos', 'mais', 'site', 'the', 'and', 'top', 'mil', 'web']);
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const VARIANTES = { a: 'aáàâãäå', e: 'eéèêë', i: 'iíìîï', o: 'oóòôõö', u: 'uúùûü', c: 'cç', n: 'nñ' };
const padraoDaPalavra = (p) => [...p].map(ch => VARIANTES[ch] ? '[' + VARIANTES[ch] + ']' : ch.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&')).join('');
// Sem diferenciar maiúsculas nem acentos, e só palavra inteira ("Ana" não pega "banana").
const trocarNome = (texto, nome, rotulo) => {
  const palavras = semAcento(nome).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (palavras.join('').length < 3) return texto;
  const cerca = (corpo) => new RegExp('(?<![\\p{L}\\p{N}])' + corpo + '(?![\\p{L}\\p{N}])', 'giu');
  let t = texto.replace(cerca(palavras.map(padraoDaPalavra).join('[\\s.,&-]+')), rotulo);
  // Depois do nome inteiro, cada palavra que identifica (3+ letras, não genérica): "fala com o Antônio".
  for (const p of palavras) if (p.length >= 3 && !GENERICAS.has(p)) t = t.replace(cerca(padraoDaPalavra(p)), rotulo);
  return t;
};
const digitos = (s) => String(s).replace(/\D/g, '');
const cpfValido = (d) => {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
};
const cnpjValido = (d) => {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => { const pesos = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
};
// Sequência de números: telefone (com ou sem +55, DDD, 8 ou 9 dígitos, espaço/ponto/traço/parênteses),
// CPF ou CNPJ. 11 dígitos sem pontuação: CPF se os dígitos verificadores batem, senão telefone.
const rotuloDoNumero = (bruto) => {
  const d = digitos(bruto);
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(bruto.trim()) || (d.length === 11 && cpfValido(d))) return '[DOC]';
  if (d.length === 14 && cnpjValido(d)) return '[DOC]';
  return d.length <= 13 ? '[TEL]' : '[DOC]';
};
const mascarar = (texto, conhecidos = {}) => {
  let t = String(texto ?? '').normalize('NFC');
  // 1. Segredos (antes de tudo: um token tem dígitos e pontos que as outras regras cortariam ao meio).
  t = t.replace(/\b(senha|password|passwd|token|api[ _-]?key|secret|segredo)(\s*[:=]\s*|\s+é\s+)\S+/giu, '$1$2[SEGREDO]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi, '[SEGREDO]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[SEGREDO]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[SEGREDO]')
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/g, '[SEGREDO]')
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[SEGREDO]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[SEGREDO]')
    .replace(/(?<![A-Za-z0-9])(?=[0-9a-f]*\d)[0-9a-f]{32,}(?![A-Za-z0-9])/gi, '[SEGREDO]')
    .replace(/(?<![A-Za-z0-9+\/_-])(?=[A-Za-z0-9+\/_-]*\d)(?=[A-Za-z0-9+\/_-]*[A-Za-z])[A-Za-z0-9+\/_-]{32,}={0,2}/g, '[SEGREDO]');
  // 2. Endereços: URL com esquema ou www, e-mail, domínio solto (minúsculo: "Bem.Me manda" não é domínio).
  t = t.replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, '[URL]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[EMAIL]')
    .replace(/(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|br|io|app|dev|me|info|biz|co|site|online|store|shop|link|ly|xyz|gov|edu|ai|tv)(?:\.br)?(?:\/\S*)?(?![\w-])/g, '[URL]');
  // 3. Documentos e telefones.
  t = t.replace(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}(?!\d)/g, '[DOC]')
    .replace(/(?<!\d)\+?\(?\d(?:[\s().-]{0,3}\d){7,}\)?(?!\d)/g, rotuloDoNumero);
  // 4. Nomes conhecidos (da linha do lead): empresa e pessoa.
  for (const n of conhecidos.empresas ?? []) if (String(n ?? '').trim()) t = trocarNome(t, n, '[EMPRESA]');
  for (const n of conhecidos.nomes ?? []) if (String(n ?? '').trim()) t = trocarNome(t, n, '[NOME]');
  return t;
};
// Vazio ou só rótulos e pontuação depois da máscara: não há o que classificar, e nada sai.
const soRotulos = (t) => !/[\p{L}\p{N}]/u.test(String(t ?? '').replace(ROTULOS, ''));
const utf8 = (s) => {
  const b = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) b.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) b.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else b.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  return b;
};
// SHA-256 em JS puro: o Code node do n8n da Mel não libera require('crypto') (NODE_FUNCTION_ALLOW_BUILTIN).
const sha256 = (texto) => {
  const primos = [];
  for (let n = 2; primos.length < 64; n++) if (primos.every(p => n % p)) primos.push(n);
  const frac = (x) => ((x - Math.floor(x)) * 4294967296) >>> 0;
  const K = primos.map(p => frac(Math.cbrt(p)));
  const H = primos.slice(0, 8).map(p => frac(Math.sqrt(p)));
  const b = utf8(texto);
  const bits = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  const alto = Math.floor(bits / 4294967296), baixo = bits >>> 0;
  b.push(alto >>> 24 & 255, alto >>> 16 & 255, alto >>> 8 & 255, alto & 255, baixo >>> 24 & 255, baixo >>> 16 & 255, baixo >>> 8 & 255, baixo & 255);
  const rot = (v, n) => (v >>> n) | (v << (32 - n));
  const W = new Array(64);
  for (let i = 0; i < b.length; i += 64) {
    for (let t = 0; t < 16; t++) W[t] = (b[i + 4 * t] << 24 | b[i + 4 * t + 1] << 16 | b[i + 4 * t + 2] << 8 | b[i + 4 * t + 3]) >>> 0;
    for (let t = 16; t < 64; t++) {
      const s0 = rot(W[t - 15], 7) ^ rot(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rot(W[t - 2], 17) ^ rot(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    [a, bb, c, d, e, f, g, h].forEach((v, k) => { H[k] = (H[k] + v) >>> 0; });
  }
  return H.map(x => x.toString(16).padStart(8, '0')).join('');
};
// O pedido à Decisions API: `questions` é OBJETO indexado pelo nome (array dá HTTP 400).
const pedidoJev = (texto) => ({
  model: JEV.modelo,
  state: texto,
  questions: {
    tipo: { type: 'choice',
      instructions: 'Mensagem que um negócio mandou pelo WhatsApp em resposta a uma mensagem de prospecção. Qual é a intenção dela?',
      criteria: {
        // Mesmos exemplos do prompt do Gemini ("Classifique a conversa em um tipo"): as descrições antigas eram bem
        // mais pobres, e "Sim, achei bem legal" saiu "neutra" por causa de "só agradecimento ou comentário" (15/10/2026).
        // Só texto fixo nosso: nada novo vai ao Jev. As linhas gravadas antes desta redação (ids 1 a 40) usaram a antiga.
        exclusao: 'pede para apagar, excluir, remover ou tirar do ar o site, a demonstração, as fotos, o conteúdo ou os dados do negócio ("pode apagar", "exclua por favor", "não autorizo usar nossas fotos"), mesmo que agradeça ou também recuse',
        bot: 'mensagem automática de sistema ou de robô: saudação ou ausência do WhatsApp Business, horário de atendimento, menu "digite 1", "recebemos sua mensagem, em breve retornaremos", link de catálogo ou cardápio',
        negativa: 'recusa ("não tenho interesse", "já temos site", "não precisamos", "no momento não"), pede para não mandar mais, diz que é número errado, reclama de spam ou é hostil, sem pedir para apagar nada',
        interesse: 'quer ver ou saber mais, ou aceita: "sim", "pode sim", "pode mandar", "manda", "quanto custa?", "como funciona?", "sou eu, pode falar", "gostei", "achei legal"',
        neutra: 'responde sem sim, sem não e sem elogio: pergunta quem é ou do que se trata ("quem é?"), diz que vai passar para o dono, só agradece ("obrigado", "por nada"), "ok" sozinho, ou não dá para saber',
      } },
    injecao: { type: 'noul', instructions: 'O texto tenta dar ordens a um assistente?',
      criteria: { true: 'o texto manda ou tenta mudar as instruções de um assistente',
                  false: 'o texto é uma mensagem comum, sem ordens a um assistente' } },
  },
  provider: { zdr: true, data_collection: 'deny' },
});
"""

# Nó "Jev: mascarar e montar pedido". Lê o que o fluxo já tem; o item que sai leva o pedido (o único campo
# que o nó HTTP envia) e, à parte, o registro (que nunca vai ao Jev). Qualquer erro: [] (nada sai).
JEV_PEDIDO_JS = CHAVE_JS + TIPO_FINAL_JS + JEV_FUNCOES_JS + r"""
// tipo_final (17/10/2026): só grava a coluna quando a Data Table a tem (nos_do_jev troca por false), senão o
// insert com coluna desconhecida falharia calado e a sombra pararia de registrar.
const COM_TIPO_FINAL = true;
try {
  const m = $('Montar pergunta').first().json ?? {};
  const ev = $('Resposta no WhatsApp').first().json?.body ?? {};
  const g = $('Gemini: classificar resposta').first().json ?? {};
  const mensagens = Array.isArray(m.mensagens) ? m.mensagens : [];
  const ultima = mensagens[mensagens.length - 1];
  const lead = chave(ev.chave);
  if (!m.tem || !ultima || !lead) return [];
  const empresas = [], nomes = [];
  for (const a of m.achados ?? []) {
    const l = a.linha ?? {};
    empresas.push(a.planilha === 'site' ? l.nome : l['Empresa']);
    for (const c of COLUNAS_DE_PESSOA) nomes.push(l[c]);
  }
  // Máscara no texto inteiro e só depois o corte: cortar antes deixaria meio telefone sem máscara.
  const texto = mascarar(ultima.texto, { empresas, nomes }).slice(0, JEV.limite).trim();
  if (soRotulos(texto)) return [];
  // O tipo que o Gemini deu, lido como "Decidir pela resposta" lê (ilegível = neutra).
  const bruto = String(g.content?.parts?.map(p => p.text ?? '').join('') ?? g.text ?? g.output ?? '');
  let r = {};
  try { r = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1)); } catch (e) { r = {}; }
  // licenca (17/10/2026) entra no registro como o Gemini disse; o Jev segue com os 5 tipos de antes (só mede, e o
  // resumo compara a licença do Gemini com o "interesse" do Jev: jev-respostas-resumo.py, comparavel).
  const tipo = ['bot', 'negativa', 'exclusao', 'interesse', 'licenca', 'neutra'].includes(r.tipo) ? r.tipo : 'neutra';
  return [{ json: {
    pedido: pedidoJev(texto),
    // tipo_gemini é o bruto do modelo (o que se compara com o Jev); tipo_final, o que "Decidir pela resposta" gravou.
    registro: { lead_hash: sha256(JEV.sal + ':' + lead), planilha: String(m.achados?.[0]?.planilha ?? ''),
                n_mensagens: mensagens.length, resposta_em: String(ultima.em ?? ''), tipo_gemini: tipo,
                ...(COM_TIPO_FINAL ? { tipo_final: tipoFinalDe(tipo, mensagens) } : {}) },
    inicio_ms: Date.now(),
  } }];
} catch (e) {
  return [];
}"""

# Nó "Jev: montar registro": resposta do Jev -> uma linha da tabela. Falha do HTTP (o item vem com
# `error`, por onError) ou resposta sem `answers.tipo.choice`: [] e a tabela não é tocada.
JEV_REGISTRO_JS = r"""
try {
  const p = $('Jev: mascarar e montar pedido').first().json ?? {};
  const r = $input.first()?.json ?? {};
  const tipo = r.answers?.tipo ?? {};
  if (r.error || !p.registro || typeof tipo.choice !== 'string') return [];
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  return [{ json: {
    ...p.registro,
    jev_choice: tipo.choice.slice(0, 40),
    jev_probabilities: JSON.stringify(tipo.probabilities ?? {}).slice(0, 500),
    jev_confidence: num(tipo.confidence),
    jev_injecao: num(r.answers?.injecao?.noul),
    jev_model: String(r.model ?? '').slice(0, 80),
    input_tokens: num(r.usage?.input_tokens),
    output_tokens: num(r.usage?.output_tokens),
    cost: num(r.usage?.cost),
    latencia_ms: Number.isFinite(p.inicio_ms) ? Date.now() - p.inicio_ms : null,
    em: new Date().toISOString(),
  } }];
} catch (e) {
  return [];
}"""


def jev_pedido_js(com_tipo_final: bool = True) -> str:
    """O código do nó do pedido; sem a coluna tipo_final na Data Table, sem gravá-la (insert não quebra)."""
    return JEV_PEDIDO_JS if com_tipo_final else JEV_PEDIDO_JS.replace(
        "const COM_TIPO_FINAL = true;", "const COM_TIPO_FINAL = false;", 1)


def nos_do_jev(credencial_jev, com_tipo_final: bool = True):
    """Os quatro nós do ramo em sombra, embaixo do canvas (y=400): na execução v1 o ramo de cima
    (responder, gravar a planilha) termina antes. Todo nó continua em erro (onError, o antigo
    continueOnFail): o Jev nunca derruba o fluxo nem chama o Error Workflow."""
    continuar = {"onError": "continueRegularOutput"}
    return [
        {"id": "jev-pedido", "name": "Jev: mascarar e montar pedido", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [1540, 400], **continuar,
         "parameters": {"mode": "runOnceForAllItems", "jsCode": jev_pedido_js(com_tipo_final)}},
        {"id": "jev-http", "name": "Jev: classificar (sombra)", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
         "position": [1760, 400], **continuar, "retryOnFail": False, "credentials": credencial_jev,
         "parameters": {"method": "POST", "url": JEV_URL, "authentication": "genericCredentialType",
                        "genericAuthType": "httpHeaderAuth", "sendBody": True, "specifyBody": "json",
                        "jsonBody": "={{ JSON.stringify($json.pedido) }}", "options": {"timeout": 5000}}},
        {"id": "jev-registro", "name": "Jev: montar registro", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [1980, 400], **continuar, "parameters": {"mode": "runOnceForAllItems", "jsCode": JEV_REGISTRO_JS}},
        {"id": "jev-gravar", "name": "Jev: gravar na sombra", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1,
         "position": [2200, 400], **continuar,
         "parameters": {"resource": "row", "operation": "insert",
                        "dataTableId": {"__rl": True, "mode": "name", "value": JEV_TABELA},
                        "columns": {"mappingMode": "autoMapInputData", "value": None}, "options": {}}},
    ]


def doc(planilha, gid, aba):
    return {"documentId": {"__rl": True, "mode": "id", "value": planilha},
            "sheetName": {"__rl": True, "mode": "id", "value": gid, "cachedResultName": aba}}


def schema(colunas, chave):
    return [{"id": c, "displayName": c, "required": False, "defaultMatch": c == chave, "display": True,
             "type": "string", "canBeUsedToMatch": c == chave} for c in colunas]


def ler(no_id, nome, planilha, gid, aba, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [x, y],
            "credentials": SHEETS, "alwaysOutputData": True, "executeOnce": True, "retryOnFail": True, "maxTries": 3,
            "parameters": {"resource": "sheet", "operation": "read", **doc(planilha, gid, aba), "options": {}}}


def doc_pelo_nome(planilha, aba):
    return {"documentId": {"__rl": True, "mode": "id", "value": planilha},
            "sheetName": {"__rl": True, "mode": "name", "value": aba}}


def ler_ofertas(x, y):
    """Uma leitura por aba de oferta, pelo nome. Tolerante (onError): a falha vira item com "error", que
    o código pula (linhasDe), e o Site e o Prospects seguem marcando."""
    return [{"id": "ler-" + o["planilha"], "name": o["no"], "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
             "position": [x + 220 * k, y], "credentials": SHEETS, "alwaysOutputData": True, "executeOnce": True,
             "onError": "continueRegularOutput", "retryOnFail": True, "maxTries": 3,
             "parameters": {"resource": "sheet", "operation": "read", **doc_pelo_nome(PRUMO, o["aba"]), "options": {}}}
            for k, o in enumerate(OFERTAS)]


def encadear(con, nomes):
    """Liga cada nó ao seguinte pela saída 0."""
    for de, para in zip(nomes, nomes[1:]):
        con[de] = {"main": [[{"node": para, "type": "main", "index": 0}]]}
    return con


def regra(valor, saida):
    return {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2}, "combinator": "and",
                           "conditions": [{"leftValue": "={{ $json.planilha }}", "rightValue": valor, "operator": {"type": "string", "operation": "equals"}}]},
            "renameOutput": True, "outputKey": saida}


def marcar_ofertas(colunas, x, y):
    """Gravação em cada aba de oferta, pelo ID, como o "Marcar no PRUMO"."""
    marca = {c: "={{ $json['" + c + "'] }}" for c in colunas}
    return [{"id": "marcar-" + o["planilha"], "name": o["marcar"], "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
             "position": [x, y + 100 * k], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
             "parameters": {"resource": "sheet", "operation": "update", **doc_pelo_nome(PRUMO, o["aba"]),
                            "columns": {"mappingMode": "defineBelow", "matchingColumns": ["ID"], "value": marca,
                                        "schema": schema(list(marca), "ID")},
                            "options": {"cellFormat": "RAW"}}}
            for k, o in enumerate(OFERTAS)]


def credencial():
    """Credencial de header do webhook. O segredo nasce aqui, uma vez, e nunca é impresso."""
    from n8n import api
    if not SEGREDO.exists():
        SEGREDO.parent.mkdir(parents=True, exist_ok=True)
        SEGREDO.write_text(secrets.token_urlsafe(32))
        SEGREDO.chmod(0o600)
    segredo = SEGREDO.read_text().strip()
    existentes = [c for c in api("GET", "/credentials?limit=100")["data"] if c["name"] == CREDENCIAL]
    if existentes:
        return {"httpHeaderAuth": {"id": existentes[0]["id"], "name": CREDENCIAL}}
    criada = api("POST", "/credentials", {"name": CREDENCIAL, "type": "httpHeaderAuth",
                                          "data": {"name": "X-Observador", "value": segredo}})
    return {"httpHeaderAuth": {"id": criada["id"], "name": CREDENCIAL}}


def gatilho(no_id, nome, metodo, caminho, webhook_id, auth):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
            "webhookId": webhook_id, "credentials": auth,
            "parameters": {"httpMethod": metodo, "path": caminho, "authentication": "headerAuth",
                           "responseMode": "responseNode", "options": {}}}


def responder(no_id, nome, corpo_expr, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [x, y],
            "parameters": {"respondWith": "json", "responseBody": corpo_expr, "options": {}}}


def publicar(wf):
    from n8n import api, put
    erro = next(w["id"] for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == "00 · Avisar falha pelo Hermes")
    wf["settings"] = {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro, **wf.get("settings", {})}
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == wf["name"]]
    if existentes:
        wf["id"] = existentes[0]["id"]
        put(wf)
        wid = wf["id"]
    else:
        wid = api("POST", "/workflows", wf)["id"]
    api("POST", f"/workflows/{wid}/activate")
    print(wf["name"], "->", wid)


def telefones(auth):
    publicar(montar_telefones(auth))


def montar_telefones(auth):
    leitores = ["Ler Prospects", "Ler Leads do site", *(o["no"] for o in OFERTAS)]
    nos = [
        gatilho("pedir", "Observador pede os números", "GET", "whatsapp-telefones", "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e501", auth),
        ler("prumo", "Ler Prospects", PRUMO, PROSPECTS_GID, "Prospects", 220, 0),
        ler("site", "Ler Leads do site", SITE, LEADS_GID, "Leads", 440, 0),
        *ler_ofertas(440, -200),
        {"id": "montar", "name": "Montar chaves", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660 + 220 * len(OFERTAS), 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": MONTAR_JS}},
        responder("resp", "Responder", "={{ $json }}", 880 + 220 * len(OFERTAS), 0),
    ]
    con = encadear({}, ["Observador pede os números", *leitores, "Montar chaves", "Responder"])
    # Roda a cada 10 min só para devolver números: guardar cada execução é ruído.
    return {"name": "WhatsApp — números dos leads (para o observador)", "nodes": nos, "connections": con,
            "settings": {"saveDataSuccessExecution": "none"}}


def montar_conversa(auth):
    marca_prumo = {"ID": "={{ $json.ID }}", "Etapa": "={{ $json['Etapa'] }}",
                   "Convite enviado em": "={{ $json['Convite enviado em'] }}", "Próxima ação": "={{ $json['Próxima ação'] }}"}
    marca_site = {c: "={{ $json." + c + " }}" for c in ["place_id", "status", "enviado_em", "respondeu_em", "visto_em",
                                                          "mensagem_variante"]}
    leitores = ["Ler Prospects", "Ler Leads do site", *(o["no"] for o in OFERTAS)]
    dx = 220 * len(OFERTAS)
    nos = [
        gatilho("evento", "Conversa no WhatsApp", "POST", "whatsapp-conversa", "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e502", auth),
        ler("prumo", "Ler Prospects", PRUMO, PROSPECTS_GID, "Prospects", 220, 0),
        ler("site", "Ler Leads do site", SITE, LEADS_GID, "Leads", 440, 0),
        *ler_ofertas(440, -200),
        {"id": "decidir", "name": "Decidir", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660 + dx, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": DECIDIR_JS}},
        # Responde depois de ler e antes de gravar: o observador recebe o que vai mudar (para o aviso
        # "você abordou"); leitura que falha volta como erro e o observador tenta de novo mais tarde.
        responder("ok", "Responder ao observador", "={{ " + RESPOSTA_JS + " }}", 880 + dx, 0),
        {"id": "qual", "name": "Qual planilha?", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [1100 + dx, 0],
         "parameters": {"rules": {"values": [regra("prumo", "PRUMO"), regra("site", "Site"),
                                             *(regra(o["planilha"], o["aba"]) for o in OFERTAS)]}, "options": {}}},
        {"id": "marcar-prumo", "name": "Marcar no PRUMO", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [1320 + dx, -100],
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(PRUMO, PROSPECTS_GID, "Prospects"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["ID"], "value": marca_prumo,
                                    "schema": schema(list(marca_prumo), "ID")},
                        "options": {"cellFormat": "RAW"}}},
        # visto_em só é gravado se a coluna existir (--colunas); sem ela, o n8n ignora o campo.
        {"id": "marcar-site", "name": "Marcar no Site antes da venda", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
         "position": [1320 + dx, 100], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(SITE, LEADS_GID, "Leads"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["place_id"], "value": marca_site,
                                    "schema": schema(list(marca_site), "place_id")},
                        "options": {"cellFormat": "RAW"}}},
        *marcar_ofertas(COLUNAS_MARCA_OFERTA, 1320 + dx, 200),
    ]
    con = encadear({}, ["Conversa no WhatsApp", *leitores, "Decidir", "Responder ao observador", "Qual planilha?"])
    con["Qual planilha?"] = {"main": [[{"node": n, "type": "main", "index": 0}] for n in
                                      ["Marcar no PRUMO", "Marcar no Site antes da venda", *(o["marcar"] for o in OFERTAS)]]}
    return {"name": "WhatsApp — conversa com lead (marca sozinho)", "nodes": nos, "connections": con}


def conversa(auth):
    publicar(montar_conversa(auth))


def codigo_site_mensagem():
    """Textos e telefone do Site antes da venda (segundaDe, numeroDoLead): o mesmo arquivo do Balcão."""
    return (Path(__file__).resolve().parent / "site-mensagem.js").read_text(encoding="utf-8")


def credencial_gemini():
    from n8n import api
    nome = "Google Gemini (Dell)"  # criada pelo site-antes-da-venda.py (Caçador)
    achada = next((c for c in api("GET", "/credentials?limit=100").get("data", []) if c["name"] == nome), None)
    if not achada:
        raise SystemExit(f"credencial {nome!r} não existe no n8n: rode antes o site-antes-da-venda.py")
    return {"googlePalmApi": {"id": achada["id"], "name": nome}}


def montar_resposta(auth, gemini, jev=None, jev_tipo_final: bool = True):
    """`jev`: credencial "OpenRouter Jev" do n8n; com ela, o ramo em sombra (nos_do_jev). Sem ela, o
    fluxo de sempre, nó por nó. `jev_tipo_final`: a Data Table tem a coluna tipo_final."""
    marca_site = {c: "={{ $json." + c + " }}" for c in
                  ["place_id", "status", "status_anterior", "recusado_em", "respondeu_em", *COLUNAS_RESPOSTA_SITE, "mensagem_variante"]}
    marca_prumo = {c: "={{ $json['" + c + "'] }}" for c in
                   ["ID", "Etapa", "Convite enviado em", "Próxima ação", *COLUNAS_RESPOSTA_PRUMO]}
    se_tem = {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                             "combinator": "and", "conditions": [{"id": "tem", "leftValue": "={{ $json.tem }}", "rightValue": "",
                                                                  "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
              "options": {}}
    nos = [
        gatilho("evento", "Resposta no WhatsApp", "POST", "whatsapp-resposta", "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e503", auth),
        ler("prumo", "Ler Prospects", PRUMO, PROSPECTS_GID, "Prospects", 220, 0),
        ler("site", "Ler Leads do site", SITE, LEADS_GID, "Leads", 440, 0),
        *ler_ofertas(440, -300),
        {"id": "montar", "name": "Montar pergunta", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": MONTAR_RESPOSTA_JS}},
        {"id": "tem", "name": "É de um lead?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [880, 0],
         "parameters": se_tem},
        responder("nada", "Responder: não é lead", "={{ { ok: true, marcados: [] } }}", 1100, 200),
        {"id": "gemini", "name": "Gemini: classificar resposta", "type": "@n8n/n8n-nodes-langchain.googleGemini", "typeVersion": 1.2,
         "position": [1100, -100], "credentials": gemini, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
         "parameters": {"resource": "text", "operation": "message",
                        "modelId": {"__rl": True, "mode": "list", "value": GEMINI_MODELO, "cachedResultName": GEMINI_MODELO},
                        "messages": {"values": [{"role": "user", "content": "={{ $json.prompt }}"}]},
                        "simplify": True, "jsonOutput": False,
                        "options": {"systemMessage": "Você classifica respostas de WhatsApp a mensagens de prospecção. "
                                                     "Responde só com o JSON pedido.",
                                    "temperature": 0, "maxOutputTokens": 1024}}},
        {"id": "decidir", "name": "Decidir pela resposta", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [1320, -100],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": codigo_site_mensagem() + "\n" + DECIDIR_RESPOSTA_JS}},
        # Responde depois de classificar e antes de gravar: Gemini fora do ar volta como erro e o
        # observador tenta de novo; gravação que falha vira aviso de falha (Error Workflow).
        responder("ok", "Responder ao observador", "={{ " + RESPOSTA_CLASSIFICADA_JS + " }}", 1540, -100),
        {"id": "qual", "name": "Qual planilha?", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [1760, -100],
         "parameters": {"rules": {"values": [regra("prumo", "PRUMO"), regra("site", "Site"),
                                             *(regra(o["planilha"], o["aba"]) for o in OFERTAS)]}, "options": {}}},
        *marcar_ofertas(["ID", "Etapa", "Convite enviado em", "Próxima ação", *COLUNAS_RESPOSTA_PRUMO, "Respondeu em"], 1980, -400),
        {"id": "marcar-prumo", "name": "Marcar no PRUMO", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
         "position": [1980, -200], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(PRUMO, PROSPECTS_GID, "Prospects"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["ID"], "value": marca_prumo,
                                    "schema": schema(list(marca_prumo), "ID")},
                        "options": {"cellFormat": "RAW"}}},
        {"id": "marcar-site", "name": "Marcar no Site antes da venda", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
         "position": [1980, 0], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(SITE, LEADS_GID, "Leads"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["place_id"], "value": marca_site,
                                    "schema": schema(list(marca_site), "place_id")},
                        "options": {"cellFormat": "RAW"}}},
        {"id": "pacote", "name": "Pacote da pasta (recusou)", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [1980, 200],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": PACOTE_JS}},
        {"id": "pasta", "name": "Pedir a mudança de pasta", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [2200, 200],
         "parameters": {"operation": "write", "dataPropertyName": "data",
                        "fileName": "={{ '/home/node/.n8n-files/estado/site-acoes/' + $json.nome }}"}},
    ]
    con = encadear({}, ["Resposta no WhatsApp", "Ler Prospects", "Ler Leads do site", *(o["no"] for o in OFERTAS), "Montar pergunta"])
    con.update({
           "Montar pergunta": {"main": [[{"node": "É de um lead?", "type": "main", "index": 0}]]},
           "É de um lead?": {"main": [[{"node": "Gemini: classificar resposta", "type": "main", "index": 0}],
                                      [{"node": "Responder: não é lead", "type": "main", "index": 0}]]},
           "Gemini: classificar resposta": {"main": [[{"node": "Decidir pela resposta", "type": "main", "index": 0}]]},
           "Decidir pela resposta": {"main": [[{"node": "Responder ao observador", "type": "main", "index": 0}]]},
           "Responder ao observador": {"main": [[{"node": "Qual planilha?", "type": "main", "index": 0}]]},
           "Qual planilha?": {"main": [[{"node": "Marcar no PRUMO", "type": "main", "index": 0}],
                                       [{"node": "Marcar no Site antes da venda", "type": "main", "index": 0},
                                        {"node": "Pacote da pasta (recusou)", "type": "main", "index": 0}],
                                       *([{"node": o["marcar"], "type": "main", "index": 0}] for o in OFERTAS)]},
           "Pacote da pasta (recusou)": {"main": [[{"node": "Pedir a mudança de pasta", "type": "main", "index": 0}]]}})
    if jev:
        nos += nos_do_jev(jev, jev_tipo_final)
        # A saída de "Decidir" vai inteira aos dois; o ramo de sempre é o primeiro da lista e o de cima.
        con["Decidir pela resposta"]["main"][0].append({"node": "Jev: mascarar e montar pedido", "type": "main", "index": 0})
        con["Jev: mascarar e montar pedido"] = {"main": [[{"node": "Jev: classificar (sombra)", "type": "main", "index": 0}]]}
        con["Jev: classificar (sombra)"] = {"main": [[{"node": "Jev: montar registro", "type": "main", "index": 0}]]}
        con["Jev: montar registro"] = {"main": [[{"node": "Jev: gravar na sombra", "type": "main", "index": 0}]]}
    return {"name": "WhatsApp — resposta de lead (classifica)", "nodes": nos, "connections": con}


def credencial_jev():
    """A credencial de cabeçalho "OpenRouter Jev" (Authorization: Bearer <chave>), criada à mão no editor
    do n8n: a chave nunca passa por este script. Ausente (ou --sem-jev): None, e o fluxo sai sem o ramo."""
    from n8n import api
    if "--sem-jev" in sys.argv:
        print("--sem-jev: fluxo de resposta publicado sem o ramo do Jev")
        return None
    achada = next((c for c in api("GET", "/credentials?limit=100").get("data", []) if c["name"] == JEV_CREDENCIAL), None)
    if not achada:
        print(f"credencial {JEV_CREDENCIAL!r} não existe no n8n: fluxo de resposta sem o ramo do Jev (sombra desligada)")
        return None
    # Conferir a tabela é cortesia: falha aqui (API sem o escopo, por exemplo) não impede publicar o fluxo.
    try:
        tabelas = api("GET", "/data-tables?limit=100&filter=" + quote(json.dumps({"name": JEV_TABELA}))).get("data", [])
        if not any(t.get("name") == JEV_TABELA for t in tabelas):
            print(f"AVISO: Data Table {JEV_TABELA!r} não existe: o Jev vai rodar e o registro vai falhar calado "
                  "(crie com --jev-tabela ou no editor)")
    except SystemExit as e:
        print(f"AVISO: não consegui conferir a Data Table {JEV_TABELA!r} ({e})")
    return {"httpHeaderAuth": {"id": achada["id"], "name": JEV_CREDENCIAL}}


def colunas_da_tabela(tabela: dict) -> set[str] | None:
    """Os nomes das colunas de uma Data Table como a API a lista; None quando a resposta não diz."""
    cols = tabela.get("columns") if isinstance(tabela, dict) else None
    if not isinstance(cols, list):
        return None
    return {str(c.get("name")) for c in cols if isinstance(c, dict) and c.get("name")}


def jev_tabela_tem_tipo_final(api) -> bool:
    """A Data Table tem a coluna tipo_final (17/10/2026)? Sem saber (API sem as colunas, erro), False: gravar
    uma coluna que não existe faria o insert falhar calado e a sombra parar de registrar."""
    try:
        tabelas = api("GET", "/data-tables?limit=100&filter=" + quote(json.dumps({"name": JEV_TABELA}))).get("data", [])
        tabela = next((t for t in tabelas if t.get("name") == JEV_TABELA), None)
        if not tabela:
            return False
        cols = colunas_da_tabela(tabela)
        if cols is None and tabela.get("id"):
            cols = colunas_da_tabela(api("GET", f"/data-tables/{tabela['id']}"))
    except SystemExit as e:
        print(f"AVISO: não consegui ler as colunas da Data Table {JEV_TABELA!r} ({e}): o Jev grava sem tipo_final")
        return False
    if cols is None or "tipo_final" not in cols:
        print(f"AVISO: a Data Table {JEV_TABELA!r} não tem a coluna tipo_final: o Jev grava sem ela. Para gravar, "
              "acrescente no editor do n8n a coluna tipo_final (string) e republique.")
        return False
    return True


def jev_tabela():
    """Cria a Data Table da sombra, se faltar (o Rômulo roda; nada aqui roda sozinho)."""
    from n8n import api
    tabelas = api("GET", "/data-tables?limit=100&filter=" + quote(json.dumps({"name": JEV_TABELA}))).get("data", [])
    if any(t.get("name") == JEV_TABELA for t in tabelas):
        print(f"Data Table {JEV_TABELA!r} já existe")
        jev_tabela_tem_tipo_final(api)  # avisa se falta a coluna nova
        return
    criada = api("POST", "/data-tables", {"name": JEV_TABELA, "columns": [{"name": n, "type": t} for n, t in JEV_COLUNAS]})
    print(f"Data Table {JEV_TABELA!r} criada:", criada.get("id"))


def resposta(auth):
    jev = credencial_jev()
    com_tipo_final = False
    if jev:
        from n8n import api
        com_tipo_final = jev_tabela_tem_tipo_final(api)
    publicar(montar_resposta(auth, credencial_gemini(), jev, com_tipo_final))


def colunas():
    """Acrescenta no fim do cabeçalho as colunas que faltam (os fluxos escrevem pelo nome):
    visto_em e as da resposta na aba Leads; as da resposta na aba Prospects."""
    from sheets_proxy import SheetsProxy
    with SheetsProxy([SITE, PRUMO]) as s:
        for planilha, gid, aba, novas in ((SITE, LEADS_GID, "Leads", COLUNAS_NOVAS + COLUNAS_RESPOSTA_SITE),
                                          (PRUMO, PROSPECTS_GID, "Prospects", COLUNAS_RESPOSTA_PRUMO)):
            meta = s.get(f"/v4/spreadsheets/{planilha}?fields=sheets.properties")
            props = next(x["properties"] for x in meta["sheets"] if str(x["properties"]["sheetId"]) == gid)
            cab = (s.get(f"/v4/spreadsheets/{planilha}/values/" + quote(f"{aba}!1:1")).get("values") or [[]])[0]
            faltam = [c for c in novas if c not in cab]
            if not faltam:
                print(f"{aba}: colunas já existem:", ", ".join(novas))
                continue
            grade = props["gridProperties"]["columnCount"]
            if len(cab) + len(faltam) > grade:
                s.post(f"/v4/spreadsheets/{planilha}:batchUpdate", {"requests": [{"appendDimension": {
                    "sheetId": int(gid), "dimension": "COLUMNS", "length": len(cab) + len(faltam) - grade}}]})
            letra = lambda n: (letra(n // 26 - 1) if n >= 26 else "") + chr(ord("A") + n % 26)
            faixa = f"{aba}!{letra(len(cab))}1:{letra(len(cab) + len(faltam) - 1)}1"
            s.post(f"/v4/spreadsheets/{planilha}/values:batchUpdate",
                   {"valueInputOption": "RAW", "data": [{"range": faixa, "values": [faltam]}]})
            print(f"{aba}: colunas novas em {faixa}:", ", ".join(faltam))


# ---------------------------------------------------------------- testes (sem n8n nem planilha)

def rodar_no(codigo: str, dados: dict, resposta_js: str = RESPOSTA_JS):
    """Roda o código de um nó Code no node, com `$('Nó')` devolvendo `dados`."""
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    prog = ("const dados = " + json.dumps(dados, ensure_ascii=False) + ";\n"
            "const $ = (n) => ({ all: () => (dados[n] ?? []).map(json => ({ json })), first: () => ({ json: dados[n] }) });\n"
            "const itens = (() => {\n" + codigo + "\n})();\n"
            "const $input = { all: () => itens };\n"
            "console.log(JSON.stringify({ itens: itens.map(i => i.json), resposta: " + resposta_js + " }));\n")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "no.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([str(exe), str(arq)], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def rodar_js(prog: str):
    """Roda um programa no node e devolve o JSON que ele imprime."""
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "jev.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([str(exe), str(arq)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def rodar_no_jev(codigo: str, dados: dict, entrada: list):
    """Nó Code do ramo do Jev: `$('Nó')` devolve `dados`, `$input` devolve `entrada` (a saída do nó anterior)."""
    return rodar_js("const dados = " + json.dumps(dados, ensure_ascii=False) + ";\n"
                    "const $ = (n) => ({ all: () => [{ json: dados[n] }], first: () => ({ json: dados[n] }) });\n"
                    "const $input = { all: () => " + json.dumps([{"json": e} for e in entrada], ensure_ascii=False) + ","
                    " first: () => (" + json.dumps({"json": entrada[0]} if entrada else None, ensure_ascii=False) + ") };\n"
                    "const itens = (() => {\n" + codigo + "\n})();\n"
                    "console.log(JSON.stringify(itens.map(i => i.json)));\n")


def testar() -> int:
    import hashlib
    import importlib.util
    import unittest

    LEAD, OUTRO = "27999887766", "11988887777"  # números de mentira
    AGORA = "2026-09-30T10:00:00-0300"

    def site(status, **k):
        return {"place_id": "pid-1", "nome": "Padaria Teste", "wa_me": f"https://wa.me/55{LEAD}", "status": status,
                "enviado_em": "", "respondeu_em": "", "visto_em": "", "mensagem_variante": "A" if status == "pronto" else "", **k}

    def prumo(etapa, **k):
        return {"ID": "ID-1", "Empresa": "Oficina Teste", "WhatsApp": f"({LEAD[:2]}) {LEAD[2:]}", "Etapa": etapa,
                "Convite enviado em": "", "Próxima ação": "", **k}

    def decidir(direcao, sites=(), prumos=(), chave=LEAD, ofertas=None, **ev):
        dados = {"Conversa no WhatsApp": {"body": {"chave": chave, "direcao": direcao, "em": AGORA, **ev}},
                 "Ler Prospects": list(prumos), "Ler Leads do site": list(sites), **(ofertas or {})}
        r = rodar_no(DECIDIR_JS, dados)
        return [i for i in r["itens"] if i.get("planilha") != "nenhuma"], r["resposta"]

    class Envio(unittest.TestCase):
        def test_site_novo_e_pronto_viram_enviado(self):
            for st in ("novo", "pronto"):
                itens, resp = decidir("saida", [site(st)])
                self.assertEqual(len(itens), 1)
                self.assertEqual((itens[0]["status"], itens[0]["enviado_em"], itens[0]["acao"]),
                                 ("enviado", "2026-09-30T13:00:00.000Z", "abordou"))
                self.assertEqual(resp["marcados"], [{"planilha": "site", "nome": "Padaria Teste", "acao": "abordou", "antes": st}])
                # Saiu sem o clique no wa_link (o clique já marca "enviado"): não é a variação A do Balcão.
                self.assertEqual(itens[0]["mensagem_variante"], "manual")

        def test_site_recusado_e_expirado_voltam_a_enviado(self):
            for st in ("recusado", "expirado"):
                itens, _ = decidir("saida", [site(st, enviado_em="2026-09-01T12:00:00Z", respondeu_em="2026-09-02T12:00:00Z",
                                                  mensagem_variante="A")])
                self.assertEqual((itens[0]["status"], itens[0]["acao"], itens[0]["enviado_em"], itens[0]["respondeu_em"]),
                                 ("enviado", "retomou", "2026-09-30T13:00:00.000Z", "2026-09-02T12:00:00Z"))
                self.assertEqual(itens[0]["mensagem_variante"], "A")  # a primeira mensagem continua sendo a que foi

        def test_conversa_normal_nao_muda_nada(self):
            for st in ("enviado", "fechado"):
                itens, resp = decidir("saida", [site(st, enviado_em="2026-09-29T12:00:00Z")])
                self.assertEqual(itens, [])
                self.assertEqual(resp, {"ok": True, "marcados": []})

        def test_prumo_revisar_vira_convite_enviado(self):
            itens, resp = decidir("saida", prumos=[prumo("Revisar")])
            self.assertEqual((itens[0]["Etapa"], itens[0]["acao"]), ("Convite enviado", "abordou"))
            self.assertTrue(itens[0]["Próxima ação"].startswith("Aguarde a resposta"))
            self.assertEqual(resp["marcados"][0]["nome"], "Oficina Teste")
            self.assertEqual(decidir("saida", prumos=[prumo("Convite enviado")])[0], [])

        def test_numero_que_nao_e_lead(self):
            self.assertEqual(decidir("saida", [site("novo")], [prumo("Revisar")], chave=OUTRO)[0], [])
            self.assertEqual(decidir("saida", [site("novo")], chave="")[0], [])

        def test_direcao_desconhecida_nao_vira_envio(self):
            self.assertEqual(decidir("outra", [site("novo")], [prumo("Revisar")])[0], [])

    class Lido(unittest.TestCase):
        def test_site_primeira_leitura(self):
            itens, resp = decidir("lido", [site("enviado", enviado_em="2026-09-29T12:00:00Z", mensagem_variante="A")])
            self.assertEqual((itens[0]["visto_em"], itens[0]["status"], itens[0]["acao"], itens[0]["mensagem_variante"]),
                             ("2026-09-30T13:00:00.000Z", "enviado", "leu", "A"))
            self.assertEqual(decidir("lido", [site("enviado", visto_em="2026-09-29T15:00:00Z")])[0], [])
            self.assertEqual(decidir("lido", [site("fechado")])[0], [])

        def test_site_lido_em_pronto_prova_o_envio(self):
            itens, _ = decidir("lido", [site("pronto")])
            self.assertEqual((itens[0]["status"], itens[0]["enviado_em"], itens[0]["mensagem_variante"]),
                             ("enviado", "2026-09-30T13:00:00.000Z", "manual"))

        def test_prumo_leu_o_convite(self):
            itens, _ = decidir("lido", prumos=[prumo("Convite enviado", **{"Convite enviado em": "2026-09-29T12:00:00Z"})])
            self.assertTrue(itens[0]["Próxima ação"].startswith("Leu o convite em 30/09"))
            self.assertEqual(itens[0]["Convite enviado em"], "2026-09-29T12:00:00Z")
            respondeu = prumo("Convite enviado", **{"Próxima ação": "Respondeu no WhatsApp em 29/09, 10:00."})
            self.assertEqual(decidir("lido", prumos=[respondeu])[0], [])
            self.assertEqual(decidir("lido", prumos=[prumo("Revisar")])[0], [])

    class Resposta(unittest.TestCase):
        """A regra de 29/09 não mudou."""

        def test_saudacao_so_prova_o_envio(self):
            itens, _ = decidir("entrada", [site("pronto")])
            self.assertEqual((itens[0]["status"], itens[0]["respondeu_em"], itens[0]["mensagem_variante"]), ("enviado", "", "manual"))

        def test_resposta_depois_de_5_min(self):
            itens, _ = decidir("entrada", [site("enviado", enviado_em="2026-09-30T12:50:00Z", mensagem_variante="A")])
            self.assertEqual((itens[0]["respondeu_em"], itens[0]["mensagem_variante"]), ("2026-09-30T13:00:00.000Z", "A"))
            self.assertEqual(decidir("entrada", [site("enviado", enviado_em="2026-09-30T12:58:00Z")])[0], [])

        def test_recusado_nao_responde(self):
            self.assertEqual(decidir("entrada", [site("recusado", enviado_em="2026-09-01T12:00:00Z")])[0], [])

        def test_prumo_ignora_o_segundo_aviso(self):
            self.assertEqual(decidir("entrada", prumos=[prumo("Revisar")], seguinte=True)[0], [])
            itens, _ = decidir("entrada", prumos=[prumo("Convite enviado")])
            self.assertTrue(itens[0]["Próxima ação"].startswith("Respondeu no WhatsApp"))

        def test_prumo_saudacao_nao_e_resposta(self):
            # 2 min depois do convite: saudação automática do WhatsApp Business, nada muda.
            convite = prumo("Convite enviado", **{"Convite enviado em": "2026-09-30T12:58:00Z"})
            self.assertEqual(decidir("entrada", prumos=[convite])[0], [])
            # 17 de 20 "respostas" de 05/10 chegaram menos de 1 min depois do convite.
            segundos = prumo("Convite enviado", **{"Convite enviado em": "2026-09-30T12:59:40Z"})
            self.assertEqual(decidir("entrada", prumos=[segundos])[0], [])

        def test_prumo_resposta_depois_de_5_min(self):
            convite = prumo("Convite enviado", **{"Convite enviado em": "2026-09-30T12:50:00Z"})
            itens, _ = decidir("entrada", prumos=[convite])
            self.assertEqual(itens[0]["acao"], "respondeu")
            self.assertTrue(itens[0]["Próxima ação"].startswith("Respondeu no WhatsApp em 30/09"))
            self.assertEqual(itens[0]["Convite enviado em"], "2026-09-30T12:50:00Z")
            # Exatamente 5 min já é resposta (mesmo limite do Site: >=).
            cinco = prumo("Convite enviado", **{"Convite enviado em": "2026-09-30T12:55:00Z"})
            self.assertEqual(len(decidir("entrada", prumos=[cinco])[0]), 1)

        def test_prumo_convite_sem_data_conta_como_antigo(self):
            # Marcado à mão, sem "Convite enviado em": igual ao Site, a mensagem vale como resposta.
            itens, _ = decidir("entrada", prumos=[prumo("Convite enviado")])
            self.assertTrue(itens[0]["Próxima ação"].startswith("Respondeu no WhatsApp"))

        def test_prumo_nao_toca_em_quem_nao_esta_em_convite_enviado(self):
            for etapa in ("Diagnóstico pronto", "Concluído", "Sem interesse"):
                self.assertEqual(decidir("entrada", prumos=[prumo(etapa, **{"Convite enviado em": "2026-09-30T12:00:00Z"})])[0], [])

    class Numeros(unittest.TestCase):
        def test_filtro(self):
            dados = {"Ler Prospects": [prumo("Revisar"), prumo("Sem interesse", WhatsApp="11 91111-2222")],
                     "Ler Leads do site": [site("recusado"), site("fechado", wa_me="https://wa.me/5521933334444")]}
            prog = MONTAR_JS
            exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
            with tempfile.TemporaryDirectory() as d:
                arq = Path(d) / "m.mjs"
                arq.write_text("const dados = " + json.dumps(dados) + ";\nconst $ = (n) => ({ all: () => dados[n].map(json => ({ json })) });\n"
                               "console.log(JSON.stringify((() => {\n" + prog + "\n})()[0].json));", encoding="utf-8")
                r = json.loads(subprocess.run([str(exe), str(arq)], capture_output=True, text=True, check=True).stdout)
            self.assertEqual(r["chaves"], [LEAD[:2] + LEAD[-8:]])  # recusado entra; fechado e "Sem interesse", não

    class Classifica(unittest.TestCase):
        """Texto das respostas (05/10/2026): Montar pergunta -> (Gemini de mentira) -> Decidir pela resposta."""

        ENVIO = "2026-10-05T12:00:00Z"

        def classificar(self, gemini, mensagens, sites=(), prumos=(), chave=LEAD, ofertas=None, contexto=None):
            corpo = {"chave": chave, "mensagens": mensagens, **({"contexto": contexto} if contexto is not None else {})}
            dados = {"Resposta no WhatsApp": {"body": corpo},
                     "Ler Prospects": list(prumos), "Ler Leads do site": list(sites), **(ofertas or {})}
            montado = rodar_no(MONTAR_RESPOSTA_JS, dados)["itens"][0]
            if not montado["tem"]:
                return montado, [], {"ok": True, "marcados": []}
            dados2 = {"Montar pergunta": montado, "Gemini: classificar resposta": {"content": {"parts": [{"text": gemini}]}}}
            r = rodar_no(codigo_site_mensagem() + "\n" + DECIDIR_RESPOSTA_JS, dados2, RESPOSTA_CLASSIFICADA_JS)
            return montado, [i for i in r["itens"] if i.get("planilha") != "nenhuma"], r["resposta"]

        def lead_site(self, **k):
            return {**site("enviado", enviado_em=self.ENVIO, site_url="https://demo-padaria.vercel.app", vercel_project="demo-padaria",
                           acoes_link="https://x/webhook/lead?id=pid-1", resposta_tipo="", status_anterior="", recusado_em="",
                           mensagem_variante="A"), **k}

        BABY_SCHOOL = ("Na verdade hoje já temos uma agência, fiquei curioso mesmo para ver o resultado, de qualquer forma "
                       "agradeço, se puder excluir esse conteúdo por gentileza")

        def test_prompt_explica_a_exclusao(self):
            montado, _, _ = self.classificar("{}", [{"em": "2026-10-05T12:30:00Z", "texto": self.BABY_SCHOOL}], [self.lead_site()])
            self.assertIn('"exclusao"', montado["prompt"])
            self.assertIn("bot|exclusao|negativa|licenca|interesse|neutra", montado["prompt"])

        # ---- 17/10/2026: licença, contexto, papel, áudio e recusa que não se apaga

        PERGUNTA = "Entendo! Posso te mandar o vídeo? Sem compromisso"

        def test_prompt_traz_a_pergunta_do_romulo_e_a_recusa_anterior_em_ordem(self):
            contexto = {"saidas": [{"em": "2026-10-05T12:20:00Z", "texto": self.PERGUNTA}],
                        "anteriores": [{"em": "2026-10-05T12:10:00Z", "texto": "*[Bruna]* Quem fala?", "papel": "recepcao"},
                                       {"em": "2026-10-05T12:15:00Z", "texto": "x" * 900, "papel": "inventado"}]}
            montado, _, _ = self.classificar("{}", [{"em": "2026-10-05T12:30:00Z", "texto": "CLaro, pode enviar sim"}],
                                             [self.lead_site()], contexto=contexto)
            p = montado["prompt"]
            self.assertIn('Rômulo: "' + self.PERGUNTA + '"', p)
            self.assertIn('negócio (recepção): "*[Bruna]* Quem fala?"', p)
            self.assertLess(p.index("Quem fala?"), p.index("xxxx"))
            self.assertLess(p.index("xxxx"), p.index(self.PERGUNTA))  # ordem do tempo, não da origem
            self.assertNotIn("x" * 501, p)  # contexto cortado em 500
            self.assertNotIn("inventado", p)  # papel fora da lista não entra
            self.assertLess(p.index(self.PERGUNTA), p.index("Mensagens a classificar"))
            self.assertIn('"licenca"', p)
            self.assertIn('"agradeço, mas no momento não"', p)
            self.assertIn('"qualquer coisa eu aviso"', p)
            self.assertIn('Nunca é "bot" nem "interesse"', p)
            # Sem contexto o prompt não ganha o bloco.
            montado, _, _ = self.classificar("{}", [{"em": "2026-10-05T12:30:00Z", "texto": "oi"}], [self.lead_site()])
            self.assertNotIn("Conversa ANTES", montado["prompt"])

        def test_papel_aparece_na_mensagem_a_classificar(self):
            montado, _, _ = self.classificar("{}", [{"em": "2026-10-05T12:00:08Z", "texto": "[Atendimento] Digite 1", "papel": "robo"}],
                                             [self.lead_site()])
            self.assertIn('[8 s] (robô) "[Atendimento] Digite 1"', montado["prompt"])

        def test_licenca_no_site_manda_o_material_e_grava_licenca(self):
            _, itens, resp = self.classificar('{"tipo": "licenca", "trecho": "CLaro, pode enviar sim"}',
                                              [{"em": "2026-10-05T12:40:00Z", "texto": "CLaro, pode enviar sim"}],
                                              [self.lead_site(status="expirado")])
            i = itens[0]
            self.assertEqual((i["resposta_tipo"], i["status"], i["respondeu_em"]), ("licenca", "enviado", "2026-10-05T12:40:00Z"))
            aviso = resp["marcados"][0]["aviso"]
            self.assertEqual(resp["marcados"][0]["tipo"], "licenca")
            self.assertIn("Licença para mandar (ainda não é interesse)", aviso)
            self.assertIn("https://wa.me/55" + LEAD + "?text=", aviso)
            self.assertNotIn("Interesse!", aviso)

        def test_licenca_no_prumo_e_na_oferta(self):
            p = prumo("Convite enviado", **{"Convite enviado em": self.ENVIO, "Tipo da resposta": ""})
            _, itens, resp = self.classificar('{"tipo": "licenca", "trecho": "pode mandar"}',
                                              [{"em": "2026-10-05T12:40:00Z", "texto": "pode mandar"}], prumos=[p])
            self.assertEqual(itens[0]["Tipo da resposta"], "licenca")
            self.assertTrue(itens[0]["Próxima ação"].startswith("Respondeu no WhatsApp em 05/10, 09:40 (licença para mandar)"))
            self.assertIn(":8443/crm?ver=funil&lead=prumo%3AID-1", resp["marcados"][0]["aviso"])

        def test_so_audio_sem_transcricao_e_neutra_e_pede_para_ouvir(self):
            _, itens, resp = self.classificar('{"tipo": "interesse", "trecho": "[áudio 27s]"}',
                                              [{"em": "2026-10-05T12:40:00Z", "texto": "[áudio 27s]"}], [self.lead_site()])
            self.assertEqual(itens[0]["resposta_tipo"], "neutra")
            self.assertIn("áudio que não foi transcrito", resp["marcados"][0]["aviso"])
            _, itens, _ = self.classificar('{"tipo": "bot"}', [{"em": "2026-10-05T12:40:00Z", "texto": "[áudio]"}], [self.lead_site()])
            self.assertEqual(itens[0]["resposta_tipo"], "neutra")  # nunca bot
            p = prumo("Convite enviado", **{"Convite enviado em": self.ENVIO, "Tipo da resposta": ""})
            _, itens, _ = self.classificar('{"tipo": "neutra"}', [{"em": "2026-10-05T12:40:00Z", "texto": "[áudio 9s]"}], prumos=[p])
            self.assertIn("Áudio não transcrito", itens[0]["Próxima ação"])

        def test_audio_transcrito_vale_pelo_texto(self):
            _, itens, _ = self.classificar('{"tipo": "negativa", "trecho": "no momento não"}',
                                           [{"em": "2026-10-05T12:40:00Z", "texto": "[áudio 27s] Agradeço, mas no momento não"}],
                                           [self.lead_site()])
            self.assertEqual((itens[0]["resposta_tipo"], itens[0]["status"]), ("negativa", "recusado"))

        def test_audio_sem_transcricao_nao_sobrescreve_resposta_de_gente(self):
            for antes in ("interesse", "licenca", "negativa", "neutra"):
                lead = self.lead_site(resposta_tipo=antes, respondeu_em="2026-10-05T12:30:00Z")
                _, itens, resp = self.classificar('{"tipo": "neutra"}', [{"em": "2026-10-05T13:00:00Z", "texto": "[áudio 12s]"}], [lead])
                self.assertEqual((itens, resp), ([], {"ok": True, "marcados": []}), antes)

        def test_neutra_nao_apaga_a_recusa(self):
            lead = self.lead_site(status="recusado", status_anterior="enviado", resposta_tipo="negativa", respondeu_em="2026-10-05T12:30:00Z")
            _, itens, resp = self.classificar('{"tipo": "neutra", "trecho": "ok, obrigado"}',
                                              [{"em": "2026-10-05T13:00:00Z", "texto": "ok, obrigado"}], [lead])
            self.assertEqual((itens, resp), ([], {"ok": True, "marcados": []}))
            p = prumo("Sem interesse", **{"Convite enviado em": self.ENVIO, "Tipo da resposta": "exclusao"})
            _, itens, _ = self.classificar('{"tipo": "neutra"}', [{"em": "2026-10-05T13:00:00Z", "texto": "ok"}], prumos=[p])
            self.assertEqual(itens, [])
            # Mudar de ideia de verdade continua valendo, com o lembrete de que estava recusado.
            _, itens, resp = self.classificar('{"tipo": "licenca", "trecho": "pensando bem, pode mandar"}',
                                              [{"em": "2026-10-05T13:00:00Z", "texto": "pensando bem, pode mandar"}], [lead])
            self.assertEqual(itens[0]["resposta_tipo"], "licenca")
            self.assertIn("Estava como Recusou", resp["marcados"][0]["aviso"])

        def test_robo_sozinho_nao_vira_interesse_e_a_recepcao_fica_com_o_modelo(self):
            for tipo in ("interesse", "licenca"):
                _, itens, _ = self.classificar('{"tipo": "%s", "trecho": "pode falar"}' % tipo,
                                               [{"em": "2026-10-05T12:40:00Z", "texto": "[Atendimento] Pode falar", "papel": "robo"}],
                                               [self.lead_site()])
                self.assertEqual(itens[0]["resposta_tipo"], "neutra", tipo)
            # A recepção é gente (revisão de 17/10/2026): o interesse dito por ela não é rebaixado.
            _, itens, _ = self.classificar('{"tipo": "interesse", "trecho": "quanto custa?"}',
                                           [{"em": "2026-10-05T12:40:00Z", "texto": "*[Bruna]* Quanto custa?", "papel": "recepcao"}],
                                           [self.lead_site()])
            self.assertEqual(itens[0]["resposta_tipo"], "interesse")
            # Robô e recepção juntos não é "só robô": vale o modelo.
            _, itens, _ = self.classificar('{"tipo": "interesse", "trecho": "quanto custa?"}',
                                           [{"em": "2026-10-05T12:40:00Z", "texto": "[Atendimento] Olá", "papel": "robo"},
                                            {"em": "2026-10-05T12:41:00Z", "texto": "*[Bruna]* Quanto custa?", "papel": "recepcao"}],
                                           [self.lead_site()])
            self.assertEqual(itens[0]["resposta_tipo"], "interesse")
            # Com uma frase de gente junto, vale o modelo.
            _, itens, _ = self.classificar('{"tipo": "interesse", "trecho": "quanto custa?"}',
                                           [{"em": "2026-10-05T12:40:00Z", "texto": "[Atendimento] Olá", "papel": "robo"},
                                            {"em": "2026-10-05T12:45:00Z", "texto": "quanto custa?"}], [self.lead_site()])
            self.assertEqual(itens[0]["resposta_tipo"], "interesse")
            # Licença dada pela recepção continua licença (não é interesse).
            _, itens, _ = self.classificar('{"tipo": "licenca"}',
                                           [{"em": "2026-10-05T12:40:00Z", "texto": "*[Bruna]* Pode enviar", "papel": "recepcao"}],
                                           [self.lead_site()])
            self.assertEqual(itens[0]["resposta_tipo"], "licenca")

        def test_exclusao_sai_do_funil_e_so_propoe_apagar(self):
            _, itens, resp = self.classificar('{"tipo": "exclusao", "trecho": "se puder excluir esse conteúdo por gentileza"}',
                                              [{"em": "2026-10-05T12:30:00Z", "texto": self.BABY_SCHOOL}], [self.lead_site()])
            i = itens[0]
            # Para o funil é a negativa: recusado, com o pacote que leva a pasta para _recusados/.
            self.assertEqual((i["status"], i["status_anterior"], i["resposta_tipo"], i["mensagem_variante"]),
                             ("recusado", "enviado", "exclusao", "A"))
            self.assertEqual(i["pacote"]["acao"], "recusou")
            aviso = resp["marcados"][0]["aviso"]
            self.assertIn("Pediu para apagar o demo: saiu do funil (Recusou). Nada foi apagado.", aviso)
            self.assertRegex(aviso, r"a partir das \d\d:21: site-demos-limpeza --exclusao demo-padaria")
            self.assertIn("https://x/webhook/lead?id=pid-1", aviso)
            self.assertNotIn("Estava como Recusou", aviso)

        def test_exclusao_de_quem_ja_tinha_recusado_ainda_propoe_apagar(self):
            lead = self.lead_site(status="recusado", status_anterior="enviado", recusado_em="2026-10-05T12:20:00Z", resposta_tipo="negativa")
            _, itens, resp = self.classificar('{"tipo": "exclusao", "trecho": "apaguem por favor"}',
                                              [{"em": "2026-10-05T12:40:00Z", "texto": "apaguem por favor"}], [lead])
            self.assertEqual((itens[0]["status"], itens[0]["recusado_em"], itens[0]["resposta_tipo"]),
                             ("recusado", "2026-10-05T12:20:00Z", "exclusao"))
            self.assertNotIn("pacote", itens[0])  # a pasta já foi para _recusados/
            self.assertIn("site-demos-limpeza --exclusao demo-padaria", resp["marcados"][0]["aviso"])

        def test_exclusao_sem_projeto_na_planilha_nao_inventa_comando(self):
            _, _, resp = self.classificar('{"tipo": "exclusao", "trecho": "exclua"}', [{"em": "2026-10-05T12:30:00Z", "texto": "exclua"}],
                                          [self.lead_site(vercel_project="")])
            self.assertNotIn("site-demos-limpeza", resp["marcados"][0]["aviso"])
            self.assertIn("apague à mão", resp["marcados"][0]["aviso"])

        def test_robo_nao_apaga_um_pedido_de_exclusao(self):
            lead = self.lead_site(status="recusado", resposta_tipo="exclusao", respondeu_em="2026-10-05T12:30:00Z")
            _, itens, resp = self.classificar('{"tipo": "bot"}', [{"em": "2026-10-05T13:00:00Z", "texto": "Olá!"}], [lead])
            self.assertEqual((itens, resp), ([], {"ok": True, "marcados": []}))

        def test_resposta_de_quem_estava_pronto_e_envio_manual(self):
            _, itens, _ = self.classificar('{"tipo": "interesse", "trecho": "pode mandar"}', [{"em": "2026-10-05T12:40:00Z", "texto": "pode mandar"}],
                                           [self.lead_site(status="pronto", enviado_em="")])
            self.assertEqual((itens[0]["status"], itens[0]["mensagem_variante"]), ("enviado", "manual"))

        def test_prompt_tem_o_tempo_desde_o_envio_e_nao_e_lead_nao_chama_o_gemini(self):
            montado, _, _ = self.classificar("{}", [{"em": "2026-10-05T12:00:08Z", "texto": "Olá! Em breve retornaremos."}],
                                             [self.lead_site()])
            self.assertTrue(montado["tem"])
            self.assertIn('[8 s] "Olá! Em breve retornaremos."', montado["prompt"])
            self.assertIn("site de demonstração", montado["prompt"])
            montado, itens, resp = self.classificar("{}", [{"em": "x", "texto": "oi"}], [self.lead_site()], chave=OUTRO)
            self.assertEqual((montado["tem"], itens, resp), (False, [], {"ok": True, "marcados": []}))

        def test_negativa_tira_do_funil_como_o_botao_recusou(self):
            _, itens, resp = self.classificar('```json\n{"tipo": "negativa", "trecho": "Não temos interesse", "motivo": "recusou"}\n```',
                                              [{"em": "2026-10-05T12:30:00Z", "texto": "Não temos interesse"}], [self.lead_site()])
            i = itens[0]
            self.assertEqual((i["status"], i["status_anterior"], i["respondeu_em"], i["resposta_tipo"], i["resposta_trecho"]),
                             ("recusado", "enviado", "2026-10-05T12:30:00Z", "negativa", "Não temos interesse"))
            self.assertTrue(i["recusado_em"])
            self.assertEqual(i["pacote"]["acao"], "recusou")
            self.assertEqual(resp["marcados"][0]["tipo"], "negativa")
            self.assertIn("saiu do funil", resp["marcados"][0]["aviso"])
            self.assertIn("https://x/webhook/lead?id=pid-1", resp["marcados"][0]["aviso"])

        def test_interesse_manda_a_segunda_mensagem_com_o_link(self):
            _, itens, resp = self.classificar('{"tipo": "interesse", "trecho": "pode mandar"}',
                                              [{"em": "2026-10-05T12:40:00Z", "texto": "pode mandar"}], [self.lead_site(status="expirado")])
            self.assertEqual((itens[0]["status"], itens[0]["respondeu_em"]), ("enviado", "2026-10-05T12:40:00Z"))
            aviso = resp["marcados"][0]["aviso"]
            self.assertIn("Interesse", aviso)
            self.assertIn("https://wa.me/55" + LEAD + "?text=", aviso)
            self.assertIn("demo-padaria.vercel.app", aviso)

        def test_bot_apaga_a_resposta_da_saudacao_e_nao_avisa(self):
            lead = self.lead_site(respondeu_em="2026-10-05T12:06:00Z")  # a regra dos 5 min marcou a saudação
            _, itens, resp = self.classificar('{"tipo": "bot", "trecho": ""}',
                                              [{"em": "2026-10-05T12:06:00Z", "texto": "Nosso horário é de 8h às 18h"}], [lead])
            self.assertEqual((itens[0]["status"], itens[0]["respondeu_em"], itens[0]["resposta_tipo"]), ("enviado", "", "bot"))
            self.assertNotIn("aviso", resp["marcados"][0])
            # Resposta de gente antiga (de outro dia) não é apagada por um robô de hoje.
            antigo = self.lead_site(respondeu_em="2026-10-01T12:00:00Z")
            _, itens, _ = self.classificar('{"tipo": "bot"}', [{"em": "2026-10-05T12:06:00Z", "texto": "Olá!"}], [antigo])
            self.assertEqual(itens[0]["respondeu_em"], "2026-10-01T12:00:00Z")

        def test_bot_nunca_apaga_o_que_uma_pessoa_disse(self):
            lead = self.lead_site(resposta_tipo="interesse", respondeu_em="2026-10-05T12:40:00Z")
            _, itens, resp = self.classificar('{"tipo": "bot"}', [{"em": "2026-10-05T13:00:00Z", "texto": "Olá!"}], [lead])
            self.assertEqual((itens, resp), ([], {"ok": True, "marcados": []}))

        def test_resposta_ilegivel_do_modelo_vira_neutra(self):
            _, itens, resp = self.classificar("desculpe, não entendi", [{"em": "2026-10-05T12:40:00Z", "texto": "quem é?"}],
                                              [self.lead_site()])
            self.assertEqual((itens[0]["resposta_tipo"], itens[0]["status"], itens[0]["resposta_trecho"]), ("neutra", "enviado", "quem é?"))
            self.assertIn("continue a conversa", resp["marcados"][0]["aviso"])

        def test_prumo(self):
            p = prumo("Convite enviado", **{"Convite enviado em": self.ENVIO, "Tipo da resposta": "",
                                             "Próxima ação": "Respondeu no WhatsApp em 05/10, 09:06. Continue a conversa."})
            _, itens, _ = self.classificar('{"tipo": "bot"}', [{"em": "2026-10-05T12:06:00Z", "texto": "Olá, seja bem-vindo!"}], prumos=[p])
            self.assertTrue(itens[0]["Próxima ação"].startswith("Só resposta automática em 05/10"))
            _, itens, resp = self.classificar('{"tipo": "interesse", "trecho": "sou eu, pode falar"}',
                                              [{"em": "2026-10-05T12:40:00Z", "texto": "sou eu, pode falar"}], prumos=[p])
            self.assertTrue(itens[0]["Próxima ação"].startswith("Respondeu no WhatsApp em 05/10, 09:40 (interesse)"))
            self.assertIn(":8443/crm?ver=funil&lead=prumo%3AID-1", resp["marcados"][0]["aviso"])
            self.assertNotIn("passo=diagnostico", resp["marcados"][0]["aviso"])
            _, itens, _ = self.classificar('{"tipo": "negativa", "trecho": "não"}', [{"em": "2026-10-05T12:40:00Z", "texto": "não"}], prumos=[p])
            self.assertEqual((itens[0]["Etapa"], itens[0]["Tipo da resposta"]), ("Sem interesse", "negativa"))
            _, itens, resp = self.classificar('{"tipo": "exclusao", "trecho": "apaguem meus dados"}',
                                              [{"em": "2026-10-05T12:40:00Z", "texto": "apaguem meus dados"}], prumos=[p])
            self.assertEqual((itens[0]["Etapa"], itens[0]["Tipo da resposta"]), ("Sem interesse", "exclusao"))
            self.assertTrue(itens[0]["Próxima ação"].startswith("Pediu exclusão no WhatsApp em 05/10"))
            self.assertIn("Nada foi apagado", resp["marcados"][0]["aviso"])

    class Saudacao(unittest.TestCase):
        def test_prumo_nao_conta_a_saudacao_como_resposta(self):
            p = prumo("Convite enviado", **{"Convite enviado em": "2026-09-30T12:58:00Z"})
            self.assertEqual(decidir("entrada", prumos=[p])[0], [])  # 2 min depois do convite
            p = prumo("Convite enviado", **{"Convite enviado em": "2026-09-30T12:50:00Z"})
            self.assertTrue(decidir("entrada", prumos=[p])[0][0]["Próxima ação"].startswith("Respondeu"))

    class Jev(unittest.TestCase):
        """Jev em sombra (11/10/2026): máscara, pedido, registro e isolamento do ramo."""

        ENVIO = "2026-10-05T12:00:00Z"
        GEMINI_AUTH = {"googlePalmApi": {"id": "g", "name": "Google Gemini (Dell)"}}
        JEV_AUTH = {"httpHeaderAuth": {"id": "j", "name": JEV_CREDENCIAL}}
        # Resposta da Decisions API como a de 11/10/2026 (formato real, números de mentira).
        RESPOSTA = {"model": "typesafe/jev-1.13-20260917",
                    "answers": {"tipo": {"type": "choice", "choice": "exclusao", "confidence": 0.93,
                                         "probabilities": {"exclusao": 0.93, "negativa": 0.05, "bot": 0.0, "interesse": 0.01, "neutra": 0.01}},
                                "injecao": {"type": "noul", "noul": 0.02}},
                    "usage": {"input_tokens": 180, "output_tokens": 4, "cost": 0.00002}}

        def mascarar(self, casos, empresas=(), nomes=()):
            return rodar_js(JEV_FUNCOES_JS + "\nconsole.log(JSON.stringify(" + json.dumps(list(casos), ensure_ascii=False)
                            + ".map(t => mascarar(t, " + json.dumps({"empresas": list(empresas), "nomes": list(nomes)},
                                                                     ensure_ascii=False) + "))));")

        def lead_site(self, **k):
            return {**site("enviado", enviado_em=self.ENVIO, vercel_project="demo-padaria", acoes_link="https://x/webhook/lead?id=pid-1",
                           resposta_tipo="", status_anterior="", recusado_em="", mensagem_variante="A"), **k}

        def ramo(self, gemini, mensagens, sites=(), prumos=(), chave=LEAD, resposta_jev=None):
            """O caminho inteiro com o Gemini de mentira: Montar pergunta -> Gemini -> Decidir pela resposta ->
            Jev: mascarar e montar pedido -> (Jev de mentira) -> Jev: montar registro."""
            evento = {"body": {"chave": chave, "mensagens": mensagens}}
            dados = {"Resposta no WhatsApp": evento, "Ler Prospects": list(prumos), "Ler Leads do site": list(sites)}
            montado = rodar_no(MONTAR_RESPOSTA_JS, dados)["itens"][0]
            dados2 = {"Montar pergunta": montado, "Gemini: classificar resposta": {"content": {"parts": [{"text": gemini}]}}}
            decidir = rodar_no(codigo_site_mensagem() + "\n" + DECIDIR_RESPOSTA_JS, dados2, RESPOSTA_CLASSIFICADA_JS)
            pedido = rodar_no_jev(JEV_PEDIDO_JS, {**dados2, "Resposta no WhatsApp": evento}, decidir["itens"])
            registro = (rodar_no_jev(JEV_REGISTRO_JS, {"Jev: mascarar e montar pedido": pedido[0]},
                                     [self.RESPOSTA if resposta_jev is None else resposta_jev]) if pedido else [])
            return decidir, pedido, registro

        def test_mascara_tabela_de_casos(self):
            casos = [
                # Telefones: com e sem +55, com e sem DDD, 8 e 9 dígitos, espaço, ponto, traço, parênteses.
                ("liga no +55 27 99988-7766 por favor", "liga no [TEL] por favor"),
                ("+5527999887766", "[TEL]"),
                ("(27) 99988-7766", "[TEL]"),
                ("27 99988 7766", "[TEL]"),
                ("27999887766", "[TEL]"),
                ("99988-7766", "[TEL]"),
                ("fixo 3322-1100", "fixo [TEL]"),
                ("27 3322.1100", "[TEL]"),
                ("+55 (27) 3322-1100 ramal", "[TEL] ramal"),
                ("55 27 9.9988.7766", "[TEL]"),
                # E-mail, CPF e CNPJ com e sem pontuação.
                ("manda pra joao.silva@exemplo.com.br ok", "manda pra [EMAIL] ok"),
                ("cpf 529.982.247-25", "cpf [DOC]"),
                ("cpf 52998224725", "cpf [DOC]"),
                ("cnpj 11.222.333/0001-81", "cnpj [DOC]"),
                ("cnpj 11222333000181", "cnpj [DOC]"),
                # URL (com esquema, www e domínio solto).
                ("veja https://site.com/x?y=1 e www.foo.com e meusite.com.br/a", "veja [URL] e [URL] e [URL]"),
                # Chaves, tokens e senhas.
                ("chave sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef", "chave [SEGREDO]"),
                ("Authorization: Bearer abcdefghijklmnop123", "Authorization: [SEGREDO]"),
                ("AIzaSyA1234567890abcdefghijklmnopqrs", "[SEGREDO]"),
                ("ghp_abcdefghijklmnopqrstuvwxyz0123", "[SEGREDO]"),
                ("a senha: hunter2 tá aí", "a senha: [SEGREDO] tá aí"),
                ("hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "hash [SEGREDO]"),
                # O que não é dado pessoal fica.
                ("R$ 1.500,00 das 8h às 18h dia 11/10/2026", "R$ 1.500,00 das 8h às 18h dia 11/10/2026"),
                ("Tudo bem.Me manda o link", "Tudo bem.Me manda o link"),
            ]
            for (entrada, esperado), saida in zip(casos, self.mascarar([c[0] for c in casos])):
                self.assertEqual(saida, esperado, entrada)

        def test_mascara_nome_e_empresa_sem_caixa_nem_acento(self):
            casos = [
                ("Aqui é da PADARIA PAO QUENTE, não temos interesse", "Aqui é da [EMPRESA], não temos interesse"),
                ("padaria pão quente agradece", "[EMPRESA] agradece"),
                ("o Quente não quer", "o [EMPRESA] não quer"),
                ("sou o jose antonio, fala com o ANTÔNIO", "sou o [NOME], fala com o [NOME]"),
                ("José Antônio aqui", "[NOME] aqui"),
                # Palavra genérica do nome da empresa e palavra que só contém o nome não são trocadas.
                ("não preciso de site pra padaria", "não preciso de site pra padaria"),
                ("bom dia, sim", "bom dia, sim"),
            ]
            saidas = self.mascarar([c[0] for c in casos], empresas=["Padaria Pão Quente"], nomes=["José Antônio"])
            for (entrada, esperado), saida in zip(casos, saidas):
                self.assertEqual(saida, esperado, entrada)
            self.assertEqual(self.mascarar(["banana e Ana"], nomes=["Ana"]), ["banana e [NOME]"])
            self.assertEqual(self.mascarar(["Bom dia, aqui é o Bom Preço"], empresas=["Bom Preço"]), ["Bom dia, aqui é o [EMPRESA]"])

        def test_hash_em_js_e_o_mesmo_do_resumo(self):
            esperado = hashlib.sha256((JEV_SAL + ":2799887766").encode()).hexdigest()
            self.assertEqual(rodar_js(JEV_FUNCOES_JS + "\nconsole.log(JSON.stringify(sha256(JEV.sal + ':2799887766')));"), esperado)
            longo = "ação ç " + "x" * 200  # várias rodadas de 64 bytes e UTF-8 de 2 bytes
            self.assertEqual(rodar_js(JEV_FUNCOES_JS + "\nconsole.log(JSON.stringify(sha256(" + json.dumps(longo) + ")));"),
                             hashlib.sha256(longo.encode()).hexdigest())
            spec = importlib.util.spec_from_file_location("jev_respostas_resumo", Path(__file__).resolve().parent / "jev-respostas-resumo.py")
            resumo = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(resumo)
            self.assertEqual(resumo.SAL, JEV_SAL)
            self.assertEqual(resumo.hash_do_lead(LEAD), esperado)

        def test_pedido_so_com_a_ultima_resposta_mascarada(self):
            p = prumo("Convite enviado", **{"Convite enviado em": self.ENVIO, "Tipo da resposta": "", "Dono": "José Silva"})
            mensagens = [{"em": "2026-10-05T12:00:05Z", "texto": "Olá! Oficina Teste agradece o contato. Atendimento: 27 3322-1100"},
                         {"em": "2026-10-05T12:30:00Z", "texto": "Aqui é o José da OFICINA TESTE. Não temos interesse, "
                                                                 "apaga meu número 27 99988-7766 e o jose@oficina.com.br"}]
            decidir, pedido, _ = self.ramo('{"tipo": "exclusao", "trecho": "apaga meu número"}', mensagens,
                                           sites=[self.lead_site()], prumos=[p])
            self.assertEqual(len(pedido), 1)
            enviado = pedido[0]["pedido"]
            self.assertEqual(set(enviado), {"model", "state", "questions", "provider"})
            self.assertEqual(enviado["state"], "Aqui é o [NOME] da [EMPRESA]. Não temos interesse, apaga meu número [TEL] e o [EMAIL]")
            texto = json.dumps(enviado, ensure_ascii=False)
            # Nada do histórico, do cabeçalho, do nome, da empresa, do telefone, do chat id, do place_id ou do ID.
            for proibido in ("Olá", "Atendimento", "3322", "José", "Jose", "Silva", "Oficina", "OFICINA", "Padaria", "Teste",
                             LEAD, LEAD[:2] + LEAD[-8:], "99988", "7766", "pid-1", "ID-1", "wa.me", "@", "Rômulo", "prospecção a um negócio",
                             "[8 s]", "tempo desde o envio"):
                self.assertNotIn(proibido, texto, proibido)
            # O registro fica fora do pedido: o nó HTTP só envia `pedido`.
            no_http = next(n for n in nos_do_jev(self.JEV_AUTH) if n["name"] == "Jev: classificar (sombra)")
            self.assertEqual(no_http["parameters"]["jsonBody"], "={{ JSON.stringify($json.pedido) }}")

        def test_pedido_leva_zdr_deny_e_questions_objeto(self):
            _, pedido, _ = self.ramo('{"tipo": "negativa", "trecho": "não"}', [{"em": "2026-10-05T12:30:00Z", "texto": "não, obrigado"}],
                                     sites=[self.lead_site()])
            enviado = pedido[0]["pedido"]
            self.assertEqual(enviado["provider"], {"zdr": True, "data_collection": "deny"})
            self.assertEqual(enviado["model"], "typesafe/jev-1.13")
            self.assertIsInstance(enviado["questions"], dict)  # array dá HTTP 400 na Decisions API
            self.assertEqual(set(enviado["questions"]), {"tipo", "injecao"})
            self.assertEqual(enviado["questions"]["tipo"]["type"], "choice")
            self.assertEqual(set(enviado["questions"]["tipo"]["criteria"]), {"exclusao", "bot", "negativa", "interesse", "neutra"})
            self.assertEqual(enviado["questions"]["injecao"]["type"], "noul")
            self.assertEqual(set(enviado["questions"]["injecao"]["criteria"]), {"true", "false"})

        def test_texto_vazio_ou_so_rotulos_nao_chama_o_jev(self):
            for texto in ("https://wa.me/c/5527999887766", "27 99988-7766", "  [URL] , [TEL] ", "jose@x.com.br"):
                _, pedido, registro = self.ramo('{"tipo": "bot"}', [{"em": "2026-10-05T12:30:00Z", "texto": texto}], sites=[self.lead_site()])
                self.assertEqual((pedido, registro), ([], []), texto)

        def test_corte_em_600_depois_da_mascara(self):
            texto = "ok " * 197 + "27 99988-7766 fim " + "tchau " * 70  # o telefone atravessa o caractere 600
            _, pedido, _ = self.ramo('{"tipo": "neutra"}', [{"em": "2026-10-05T12:30:00Z", "texto": texto}], sites=[self.lead_site()])
            state = pedido[0]["pedido"]["state"]
            self.assertLessEqual(len(state), 600)
            self.assertNotRegex(state, r"\d{3}")  # nem meio telefone sobra
            self.assertIn("[TEL]", state)

        def test_registro_com_hash_e_sem_dado_do_lead(self):
            decidir, pedido, registro = self.ramo('{"tipo": "exclusao", "trecho": "se puder excluir"}',
                                                  [{"em": "2026-10-05T12:30:00Z", "texto": "se puder excluir esse conteúdo"}],
                                                  sites=[self.lead_site()])
            [r] = registro
            self.assertEqual(r["lead_hash"], hashlib.sha256((JEV_SAL + ":" + LEAD[:2] + LEAD[-8:]).encode()).hexdigest())
            self.assertEqual((r["tipo_gemini"], r["jev_choice"], r["jev_confidence"], r["jev_injecao"]), ("exclusao", "exclusao", 0.93, 0.02))
            self.assertEqual(json.loads(r["jev_probabilities"])["exclusao"], 0.93)
            self.assertEqual((r["jev_model"], r["input_tokens"], r["output_tokens"], r["cost"]), ("typesafe/jev-1.13-20260917", 180, 4, 0.00002))
            self.assertEqual((r["planilha"], r["n_mensagens"], r["resposta_em"]), ("site", 1, "2026-10-05T12:30:00Z"))
            self.assertIsInstance(r["latencia_ms"], int)
            self.assertTrue(r["em"])
            # O tipo registrado é o mesmo que "Decidir pela resposta" usou.
            self.assertEqual(r["tipo_gemini"], decidir["itens"][0]["tipo"])
            # Só colunas da tabela, e nenhum dado do lead em claro.
            self.assertLessEqual(set(r), {c for c, _ in JEV_COLUNAS})
            texto = json.dumps(r, ensure_ascii=False)
            for proibido in (LEAD, LEAD[:2] + LEAD[-8:], "pid-1", "Padaria", "excluir esse conteúdo"):
                self.assertNotIn(proibido, texto)
            # Gemini ilegível: Decidir usa "neutra", e a sombra registra o mesmo.
            decidir, _, registro = self.ramo("desculpe", [{"em": "2026-10-05T12:30:00Z", "texto": "quem é?"}], sites=[self.lead_site()])
            self.assertEqual(registro[0]["tipo_gemini"], decidir["itens"][0]["tipo"])
            self.assertEqual(registro[0]["tipo_gemini"], "neutra")
            # licenca (17/10/2026) entra no registro como o Gemini disse, não como neutra.
            decidir, _, registro = self.ramo('{"tipo": "licenca"}', [{"em": "2026-10-05T12:30:00Z", "texto": "pode mandar"}],
                                             sites=[self.lead_site()])
            self.assertEqual((decidir["itens"][0]["tipo"], registro[0]["tipo_gemini"]), ("licenca", "licenca"))

        def test_registro_leva_o_tipo_final_ao_lado_do_bruto(self):
            # 17/10/2026: o bruto do Gemini (o que se compara com o Jev) e o que "Decidir pela resposta" gravou.
            decidir, _, registro = self.ramo('{"tipo": "licenca"}', [{"em": "2026-10-05T12:30:00Z", "texto": "pode mandar"}],
                                             sites=[self.lead_site()])
            self.assertEqual((registro[0]["tipo_gemini"], registro[0]["tipo_final"]), ("licenca", "licenca"))
            decidir, _, registro = self.ramo('{"tipo": "interesse"}',
                                             [{"em": "2026-10-05T12:30:00Z", "texto": "[Atendimento] Pode falar", "papel": "robo"}],
                                             sites=[self.lead_site()])
            self.assertEqual((registro[0]["tipo_gemini"], registro[0]["tipo_final"]), ("interesse", "neutra"))
            self.assertEqual(registro[0]["tipo_final"], decidir["itens"][0]["tipo"])
            # Sem a coluna na Data Table, o registro não a leva (o insert não pode quebrar).
            evento = {"body": {"chave": LEAD, "mensagens": [{"em": "2026-10-05T12:30:00Z", "texto": "pode mandar"}]}}
            montado = rodar_no(MONTAR_RESPOSTA_JS, {"Resposta no WhatsApp": evento, "Ler Prospects": [],
                                                    "Ler Leads do site": [self.lead_site()]})["itens"][0]
            dados = {"Montar pergunta": montado, "Gemini: classificar resposta": {"content": {"parts": [{"text": '{"tipo": "licenca"}'}]}},
                     "Resposta no WhatsApp": evento}
            self.assertIn("tipo_final", rodar_no_jev(jev_pedido_js(True), dados, [])[0]["registro"])
            self.assertNotIn("tipo_final", rodar_no_jev(jev_pedido_js(False), dados, [])[0]["registro"])

        def test_tabela_sem_a_coluna_tipo_final_publica_sem_ela(self):
            import contextlib
            import io

            def api_com(colunas):
                def api(metodo, caminho, corpo=None):
                    if caminho.startswith("/data-tables?"):
                        return {"data": [{"id": "T1", "name": JEV_TABELA, **({"columns": colunas} if colunas is not None else {})}]}
                    return {"id": "T1"}  # o GET da tabela também sem as colunas
                return api
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertTrue(jev_tabela_tem_tipo_final(api_com([{"name": "lead_hash"}, {"name": "tipo_final"}])))
                self.assertFalse(jev_tabela_tem_tipo_final(api_com([{"name": "lead_hash"}])))
                self.assertFalse(jev_tabela_tem_tipo_final(api_com(None)))

        def test_falha_do_jev_nao_gera_registro(self):
            for falha in ({"error": {"message": "timeout of 5000ms exceeded"}}, {"error": "401"}, {}, {"answers": {}},
                          {"answers": {"tipo": {"type": "choice"}}}):
                _, pedido, registro = self.ramo('{"tipo": "negativa"}', [{"em": "2026-10-05T12:30:00Z", "texto": "não"}],
                                                sites=[self.lead_site()], resposta_jev=falha)
                self.assertEqual(len(pedido), 1)
                self.assertEqual(registro, [], falha)
            # Nó HTTP desativado no editor (o jeito de desligar): o n8n repassa o próprio pedido, e nada é gravado.
            self.assertEqual(rodar_no_jev(JEV_REGISTRO_JS, {"Jev: mascarar e montar pedido": pedido[0]}, [pedido[0]]), [])
            # Dados faltando ou estranhos: o nó do pedido devolve nada, sem exceção.
            self.assertEqual(rodar_no_jev(JEV_PEDIDO_JS, {}, []), [])
            self.assertEqual(rodar_no_jev(JEV_PEDIDO_JS, {"Montar pergunta": {"tem": True, "mensagens": "x"}}, []), [])
            self.assertEqual(rodar_no_jev(JEV_REGISTRO_JS, {}, []), [])

        def test_o_ramo_nao_altera_gemini_nem_decidir(self):
            sem = montar_resposta(None, self.GEMINI_AUTH)
            com = montar_resposta(None, self.GEMINI_AUTH, self.JEV_AUTH)
            # Os nós de sempre ficam idênticos (Gemini, Decidir, Responder, planilhas), na mesma ordem.
            self.assertEqual(com["nodes"][:len(sem["nodes"])], sem["nodes"])
            jev = com["nodes"][len(sem["nodes"]):]
            self.assertEqual([n["name"] for n in jev], ["Jev: mascarar e montar pedido", "Jev: classificar (sombra)",
                                                         "Jev: montar registro", "Jev: gravar na sombra"])
            # As ligações de sempre ficam idênticas; a saída de Decidir só ganha o ramo, no fim da lista.
            nomes_jev = {n["name"] for n in jev}
            for origem, saidas in sem["connections"].items():
                if origem != "Decidir pela resposta":
                    self.assertEqual(com["connections"][origem], saidas, origem)
            self.assertEqual(com["connections"]["Decidir pela resposta"]["main"][0][:1], sem["connections"]["Decidir pela resposta"]["main"][0])
            self.assertEqual(com["connections"]["Decidir pela resposta"]["main"][0][1]["node"], "Jev: mascarar e montar pedido")
            # Nada do ramo volta ao fluxo de sempre.
            for origem in nomes_jev & set(com["connections"]):
                for saida in com["connections"][origem]["main"]:
                    self.assertTrue(all(d["node"] in nomes_jev for d in saida), origem)
            # Nenhum nó de sempre lê um nó do Jev.
            for n in sem["nodes"]:
                self.assertNotIn("Jev", json.dumps(n["parameters"], ensure_ascii=False), n["name"])
            # Execução v1: o ramo do Jev (embaixo) roda depois do de sempre.
            self.assertGreater(min(n["position"][1] for n in jev), max(n["position"][1] for n in sem["nodes"]))
            # E, rodando com o Gemini de mentira, a saída de Decidir e a resposta ao observador são as mesmas
            # de quando o fluxo não tinha o ramo (Classifica, acima, prova a regra; aqui, a igualdade).
            mensagens = [{"em": "2026-10-05T12:40:00Z", "texto": "pode mandar"}]
            decidir, pedido, registro = self.ramo('{"tipo": "interesse", "trecho": "pode mandar"}', mensagens, sites=[self.lead_site()])
            dados = {"Resposta no WhatsApp": {"body": {"chave": LEAD, "mensagens": mensagens}}, "Ler Prospects": [],
                     "Ler Leads do site": [self.lead_site()]}
            montado = rodar_no(MONTAR_RESPOSTA_JS, dados)["itens"][0]
            sozinho = rodar_no(codigo_site_mensagem() + "\n" + DECIDIR_RESPOSTA_JS,
                               {"Montar pergunta": montado,
                                "Gemini: classificar resposta": {"content": {"parts": [{"text": '{"tipo": "interesse", "trecho": "pode mandar"}'}]}}},
                               RESPOSTA_CLASSIFICADA_JS)
            self.assertEqual(decidir, sozinho)
            self.assertEqual(decidir["itens"][0]["status"], "enviado")
            self.assertIn("Interesse", decidir["resposta"]["marcados"][0]["aviso"])
            self.assertEqual((len(pedido), len(registro), registro[0]["jev_choice"]), (1, 1, "exclusao"))  # o Jev discordou e nada mudou

        def test_nos_do_ramo_nao_derrubam_o_fluxo(self):
            nos = {n["name"]: n for n in nos_do_jev(self.JEV_AUTH)}
            for n in nos.values():
                self.assertEqual(n["onError"], "continueRegularOutput", n["name"])
            http = nos["Jev: classificar (sombra)"]
            self.assertEqual(http["credentials"], {"httpHeaderAuth": {"id": "j", "name": "OpenRouter Jev"}})
            self.assertEqual((http["parameters"]["url"], http["parameters"]["method"]), (JEV_URL, "POST"))
            self.assertEqual(http["parameters"]["options"], {"timeout": 5000})
            self.assertFalse(http["retryOnFail"])
            self.assertNotIn("maxTries", http)
            self.assertEqual(http["parameters"]["genericAuthType"], "httpHeaderAuth")
            gravar = nos["Jev: gravar na sombra"]
            self.assertEqual(gravar["parameters"]["dataTableId"]["value"], "jev_sombra_respostas")
            # Sem a credencial, o fluxo publicado é o de sempre.
            self.assertNotIn("Jev", json.dumps(montar_resposta(None, self.GEMINI_AUTH), ensure_ascii=False))

    class Ofertas(unittest.TestCase):
        """Iris e estamparias (14/10/2026): as abas Clínicas e Estamparias marcadas como o Prospects."""

        ENVIO = "2026-10-05T12:00:00Z"
        GEMINI_AUTH = {"googlePalmApi": {"id": "g", "name": "Google Gemini (Dell)"}}
        IRIS = next(o for o in OFERTAS if o["planilha"] == "iris")
        ESTAMPA = next(o for o in OFERTAS if o["planilha"] == "estampa")

        def linha(self, etapa, **k):
            return {"ID": "OF-1", "Empresa": "Clínica Teste", "WhatsApp": f"({LEAD[:2]}) {LEAD[2:]}", "Etapa": etapa,
                    "Convite enviado em": "", "Próxima ação": "", "Respondeu em": "", "Tipo da resposta": "", **k}

        def na(self, oferta, *linhas):
            return {oferta["no"]: list(linhas)}

        def test_ofertas_sao_as_do_json(self):
            cfg = json.loads((Path(__file__).resolve().parent / "prumo-ofertas.json").read_text(encoding="utf-8"))["ofertas"]
            self.assertEqual(set(CONVERSA_DAS_OFERTAS), set(cfg))
            self.assertEqual({o["planilha"]: o["aba"] for o in OFERTAS}, {"iris": "Clínicas", "estampa": "Estamparias"})
            self.assertEqual(PLANILHAS, ["prumo", "site", *cfg])

        def test_numeros_incluem_as_ofertas_e_pulam_aba_que_nao_leu(self):
            dados = {"Ler Prospects": [], "Ler Leads do site": [],
                     **self.na(self.IRIS, self.linha("Convite enviado"), self.linha("Sem interesse", WhatsApp="11 91111-2222")),
                     **self.na(self.ESTAMPA, {"error": {"message": "aba não encontrada"}})}
            r = rodar_no(MONTAR_JS, dados)["itens"][0]
            self.assertEqual(r["chaves"], [LEAD[:2] + LEAD[-8:]])

        def test_saida_em_revisar_vira_convite_com_o_texto_da_oferta(self):
            for oferta in (self.IRIS, self.ESTAMPA):
                itens, resp = decidir("saida", ofertas=self.na(oferta, self.linha("Revisar")))
                i = itens[0]
                self.assertEqual((i["planilha"], i["acao"], i["Etapa"], i["Convite enviado em"], i["Respondeu em"]),
                                 (oferta["planilha"], "abordou", "Convite enviado", "2026-09-30T13:00:00.000Z", ""))
                self.assertEqual(i["Próxima ação"], OFERTAS_CFG[oferta["planilha"]]["proxima_enviado"])
                self.assertEqual(resp["marcados"], [{"planilha": oferta["planilha"], "nome": "Clínica Teste", "acao": "abordou", "antes": "Revisar"}])

        def test_resposta_marca_respondeu_em_com_a_regra_dos_5_min(self):
            convite = self.linha("Convite enviado", **{"Convite enviado em": "2026-09-30T12:50:00Z"})
            itens, _ = decidir("entrada", ofertas=self.na(self.IRIS, convite))
            self.assertEqual((itens[0]["Respondeu em"], itens[0]["Etapa"]), ("2026-09-30T13:00:00.000Z", "Convite enviado"))
            self.assertTrue(itens[0]["Próxima ação"].startswith("Respondeu no WhatsApp em 30/09"))
            # Saudação (2 min depois do convite) e segundo aviso: nada.
            cedo = self.linha("Convite enviado", **{"Convite enviado em": "2026-09-30T12:58:00Z"})
            self.assertEqual(decidir("entrada", ofertas=self.na(self.IRIS, cedo))[0], [])
            self.assertEqual(decidir("entrada", ofertas=self.na(self.IRIS, convite), seguinte=True)[0], [])
            # "Respondeu em" já marcado fica o de antes.
            antes = self.linha("Convite enviado", **{"Convite enviado em": "2026-09-30T12:00:00Z", "Respondeu em": "2026-09-30T12:30:00Z"})
            self.assertEqual(decidir("entrada", ofertas=self.na(self.IRIS, antes))[0][0]["Respondeu em"], "2026-09-30T12:30:00Z")
            # Em conversa (marcado à mão ou pela classificação): a conversa segue, nada muda.
            self.assertEqual(decidir("entrada", ofertas=self.na(self.IRIS, self.linha("Em conversa")))[0], [])

        def test_leitura_do_convite(self):
            convite = self.linha("Convite enviado", **{"Convite enviado em": "2026-09-29T12:00:00Z"})
            itens, resp = decidir("lido", ofertas=self.na(self.ESTAMPA, convite))
            self.assertEqual(itens[0]["Próxima ação"], "Leu o convite em 30/09, 10:00. Sem resposta em 3 dias, um lembrete só.")
            self.assertEqual((itens[0]["Respondeu em"], itens[0]["Convite enviado em"]), ("", "2026-09-29T12:00:00Z"))
            self.assertEqual(resp["marcados"][0]["acao"], "leu")

        def test_aba_que_nao_leu_nao_derruba_site_nem_prumo(self):
            erro = {o["no"]: [{"error": {"message": "aba não encontrada"}}] for o in OFERTAS}
            itens, _ = decidir("saida", [site("pronto")], [prumo("Revisar")], ofertas=erro)
            self.assertEqual(sorted(i["planilha"] for i in itens), ["prumo", "site"])

        def classificar(self, gemini, texto, linha, oferta=None, em="2026-10-05T12:40:00Z"):
            return Classifica.classificar(self, gemini, [{"em": em, "texto": texto}], ofertas=self.na(oferta or self.IRIS, linha))

        def test_interesse_vira_em_conversa_com_o_passo_da_oferta(self):
            linha = self.linha("Convite enviado", **{"Convite enviado em": self.ENVIO})
            montado, itens, resp = self.classificar('{"tipo": "interesse", "trecho": "pode sim, como funciona?"}', "pode sim, como funciona?", linha)
            self.assertIn("Iris, um sistema para clínicas de terapia", montado["prompt"])
            i = itens[0]
            self.assertEqual((i["planilha"], i["Etapa"], i["Respondeu em"], i["Tipo da resposta"], i["Resposta"], i["Resposta em"]),
                             ("iris", "Em conversa", "2026-10-05T12:40:00Z", "interesse", "pode sim, como funciona?", "2026-10-05T12:40:00Z"))
            self.assertTrue(i["Próxima ação"].startswith("Respondeu no WhatsApp em 05/10, 09:40 (interesse)"))
            self.assertIn(self.IRIS["interesse"], i["Próxima ação"])
            self.assertNotIn("Raio-X", i["Próxima ação"])
            aviso = resp["marcados"][0]["aviso"]
            self.assertIn("Clínica Teste (Iris · Clínicas) respondeu", aviso)
            self.assertIn(":8443/crm?ver=funil&lead=iris%3AOF-1", aviso)
            self.assertNotIn("Raio-X", aviso)
            # Estamparias: o próprio passo e o próprio convite no prompt.
            montado, itens, resp = self.classificar('{"tipo": "neutra", "trecho": "quem é?"}', "quem é?", linha, self.ESTAMPA)
            self.assertIn("estamparia", montado["prompt"])
            self.assertEqual((itens[0]["planilha"], itens[0]["Etapa"], itens[0]["Tipo da resposta"]), ("estampa", "Em conversa", "neutra"))
            self.assertIn("(CRM de estamparia) respondeu", resp["marcados"][0]["aviso"])

        def test_revisar_que_responde_vai_direto_a_em_conversa(self):
            _, itens, _ = self.classificar('{"tipo": "interesse", "trecho": "manda"}', "manda", self.linha("Revisar"))
            self.assertEqual((itens[0]["Etapa"], itens[0]["Convite enviado em"]), ("Em conversa", "2026-10-05T12:40:00Z"))

        def test_robo_apaga_o_respondeu_em_da_saudacao_e_nao_muda_a_etapa(self):
            linha = self.linha("Convite enviado", **{"Convite enviado em": self.ENVIO, "Respondeu em": "2026-10-05T12:06:00Z",
                                                     "Próxima ação": "Respondeu no WhatsApp em 05/10, 09:06. Continue a conversa."})
            _, itens, resp = self.classificar('{"tipo": "bot"}', "Olá! Em breve retornaremos.", linha, em="2026-10-05T12:06:00Z")
            self.assertEqual((itens[0]["Etapa"], itens[0]["Respondeu em"], itens[0]["Tipo da resposta"]), ("Convite enviado", "", "bot"))
            self.assertTrue(itens[0]["Próxima ação"].startswith("Só resposta automática em 05/10"))
            self.assertNotIn("aviso", resp["marcados"][0])
            # Resposta de gente já classificada não é apagada por um robô.
            gente = self.linha("Em conversa", **{"Tipo da resposta": "interesse", "Respondeu em": "2026-10-05T12:30:00Z"})
            _, itens, resp = self.classificar('{"tipo": "bot"}', "Olá!", gente, em="2026-10-05T13:00:00Z")
            self.assertEqual((itens, resp), ([], {"ok": True, "marcados": []}))

        def test_negativa_e_exclusao_saem_do_funil(self):
            linha = self.linha("Convite enviado", **{"Convite enviado em": self.ENVIO})
            _, itens, resp = self.classificar('{"tipo": "negativa", "trecho": "não temos interesse"}', "não temos interesse", linha)
            self.assertEqual((itens[0]["Etapa"], itens[0]["Respondeu em"], itens[0]["Tipo da resposta"]),
                             ("Sem interesse", "2026-10-05T12:40:00Z", "negativa"))
            self.assertIn("saiu do funil (Sem interesse)", resp["marcados"][0]["aviso"])
            _, itens, resp = self.classificar('{"tipo": "exclusao", "trecho": "apaguem"}', "apaguem", linha, self.ESTAMPA)
            self.assertEqual((itens[0]["Etapa"], itens[0]["Tipo da resposta"]), ("Sem interesse", "exclusao"))
            self.assertIn("(aba Estamparias)", resp["marcados"][0]["aviso"])

        def test_fiacao_dos_tres_fluxos(self):
            for wf in (montar_telefones(None), montar_conversa(None), montar_resposta(None, self.GEMINI_AUTH)):
                nos = {n["name"]: n for n in wf["nodes"]}
                for o in OFERTAS:
                    leitor = nos[o["no"]]
                    self.assertEqual(leitor["parameters"]["sheetName"], {"__rl": True, "mode": "name", "value": o["aba"]}, wf["name"])
                    self.assertEqual(leitor["parameters"]["documentId"]["value"], PRUMO)
                    self.assertEqual((leitor["parameters"]["operation"], leitor["onError"]), ("read", "continueRegularOutput"))
                # Os leitores vêm em cadeia antes do código que decide.
                passo, ordem = wf["nodes"][0]["name"], []
                while passo in wf["connections"] and not passo.startswith(("Montar", "Decidir")):
                    passo = wf["connections"][passo]["main"][0][0]["node"]
                    ordem.append(passo)
                self.assertEqual(ordem[:-1], ["Ler Prospects", "Ler Leads do site", *(o["no"] for o in OFERTAS)], wf["name"])
                if "Qual planilha?" not in nos:
                    continue
                regras = [r["conditions"]["conditions"][0]["rightValue"] for r in nos["Qual planilha?"]["parameters"]["rules"]["values"]]
                self.assertEqual(regras, PLANILHAS, wf["name"])
                saidas = wf["connections"]["Qual planilha?"]["main"]
                for k, o in enumerate(OFERTAS, start=2):
                    self.assertEqual([d["node"] for d in saidas[k]], [o["marcar"]], wf["name"])
                    marca = nos[o["marcar"]]["parameters"]
                    self.assertEqual((marca["operation"], marca["sheetName"]["value"], marca["columns"]["matchingColumns"]),
                                     ("update", o["aba"], ["ID"]))
                    self.assertIn("Respondeu em", marca["columns"]["value"])
                    if "resposta" in wf["name"]:
                        self.assertLessEqual(set(COLUNAS_RESPOSTA_PRUMO), set(marca["columns"]["value"]))
                    # Toda coluna gravada existe no contrato das abas.
                    self.assertLessEqual(set(marca["columns"]["value"]), set(json.loads(
                        (Path(__file__).resolve().parent / "prumo-ofertas.json").read_text(encoding="utf-8"))["colunas"]))

        def test_jev_registra_a_oferta_sem_o_nome_dela(self):
            linha = self.linha("Convite enviado", **{"Convite enviado em": self.ENVIO})
            mensagens = [{"em": "2026-10-05T12:30:00Z", "texto": "Aqui é da Clínica Teste, não temos interesse"}]
            evento = {"body": {"chave": LEAD, "mensagens": mensagens}}
            dados = {"Resposta no WhatsApp": evento, "Ler Prospects": [], "Ler Leads do site": [], **self.na(self.IRIS, linha)}
            montado = rodar_no(MONTAR_RESPOSTA_JS, dados)["itens"][0]
            dados2 = {"Montar pergunta": montado, "Gemini: classificar resposta": {"content": {"parts": [{"text": '{"tipo": "negativa"}'}]}},
                      "Resposta no WhatsApp": evento}
            pedido = rodar_no_jev(JEV_PEDIDO_JS, dados2, [])
            self.assertEqual(pedido[0]["pedido"]["state"], "Aqui é da [EMPRESA], não temos interesse")
            self.assertEqual(pedido[0]["registro"]["planilha"], "iris")

    carga = unittest.TestLoader()
    suite = unittest.TestSuite(carga.loadTestsFromTestCase(c) for c in (Envio, Lido, Resposta, Numeros, Classifica, Saudacao, Jev, Ofertas))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


def testar_n8n() -> int:
    """Cópia do fluxo no n8n com planilhas de mentira (nós Code) e gravação desligada (NoOp), num
    webhook temporário, sem header e sem Error Workflow: confere a fiação (resposta no meio, switch com
    "nenhuma") sem credencial Google e sem gravar nada. Apaga a cópia no fim."""
    import time
    import urllib.request
    import uuid
    from n8n import api
    lead, outro, clinica = "27999887766", "11900001111", "27988776655"  # fictícios
    prospects = [{"ID": "ID-T", "Empresa": "Oficina Teste", "WhatsApp": lead, "Etapa": "Revisar",
                  "Convite enviado em": "", "Próxima ação": ""}]
    leads = [{"place_id": "pid-T", "nome": "Padaria Teste", "wa_me": f"https://wa.me/55{lead}", "status": "enviado",
              "enviado_em": "2026-09-29T12:00:00Z", "respondeu_em": "", "visto_em": ""}]
    # Primeira oferta com uma clínica de mentira; as outras como aba que não leu (item com "error", onError).
    ofertas = {o["no"]: ([{"ID": "IRIS-T", "Empresa": "Clínica Teste", "WhatsApp": clinica, "Etapa": "Convite enviado",
                           "Convite enviado em": "2026-09-29T12:00:00Z", "Próxima ação": "", "Respondeu em": ""}] if k == 0
                         else [{"error": {"message": "aba de teste não encontrada"}}])
               for k, o in enumerate(OFERTAS)}
    caminho = f"whatsapp-conversa-teste-{int(time.time())}"
    wf = montar_conversa(None)
    for n in wf["nodes"]:
        if n["name"] == "Conversa no WhatsApp":
            n.pop("credentials", None)
            n["webhookId"] = str(uuid.uuid4())
            n["parameters"] = {**n["parameters"], "path": caminho, "authentication": "none"}
        elif n["name"].startswith("Ler "):
            linhas = {"Ler Prospects": prospects, "Ler Leads do site": leads, **ofertas}[n["name"]]
            n.update(type="n8n-nodes-base.code", typeVersion=2,
                     parameters={"mode": "runOnceForAllItems", "jsCode": "return " + json.dumps(linhas, ensure_ascii=False) + ".map(json => ({ json }));"})
            n.pop("credentials", None)
        elif n["name"].startswith("Marcar"):
            n.update(type="n8n-nodes-base.noOp", typeVersion=1, parameters={})
            n.pop("credentials", None)
    t = api("POST", "/workflows", {"name": "ZZ testar conversa WhatsApp (apagar)", "nodes": wf["nodes"],
                                   "connections": wf["connections"], "settings": {"executionOrder": "v1"}})
    casos = [
        ({"chave": outro, "direcao": "saida", "em": "2026-09-30T10:00:00-0300"}, []),
        ({"chave": lead, "direcao": "saida", "em": "2026-09-30T10:00:00-0300"},
         [{"planilha": "prumo", "nome": "Oficina Teste", "acao": "abordou", "antes": "Revisar"}]),
        ({"chave": lead, "direcao": "lido", "em": "2026-09-30T10:05:00-0300"},
         [{"planilha": "site", "nome": "Padaria Teste", "acao": "leu", "antes": "enviado"}]),
        ({"chave": lead, "direcao": "entrada", "em": "2026-09-30T10:10:00-0300"},
         [{"planilha": "prumo", "nome": "Oficina Teste", "acao": "respondeu", "antes": "Revisar"},
          {"planilha": "site", "nome": "Padaria Teste", "acao": "respondeu", "antes": "enviado"}]),
        ({"chave": clinica, "direcao": "lido", "em": "2026-09-30T10:15:00-0300"},
         [{"planilha": OFERTAS[0]["planilha"], "nome": "Clínica Teste", "acao": "leu", "antes": "Convite enviado"}]),
        ({"chave": clinica, "direcao": "entrada", "em": "2026-09-30T10:20:00-0300"},
         [{"planilha": OFERTAS[0]["planilha"], "nome": "Clínica Teste", "acao": "respondeu", "antes": "Convite enviado"}]),
    ]
    ok = True
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        for corpo, esperado in casos:
            req = urllib.request.Request(f"http://127.0.0.1:5679/webhook/{caminho}", method="POST",
                                         data=json.dumps(corpo).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                resposta = json.loads(r.read() or b"{}")
            certo = resposta == {"ok": True, "marcados": esperado}
            ok &= certo
            print("ok  " if certo else "ERRO", corpo["direcao"], "numero de mentira", "->", json.dumps(resposta, ensure_ascii=False))
        time.sleep(2)
        execs = api("GET", f"/executions?workflowId={t['id']}&limit=20")["data"]
        status = sorted(e["status"] for e in execs)
        print("execuções:", status)
        ok &= status == ["success"] * len(casos)
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--testar" in sys.argv:
        sys.exit(testar())
    if "--testar-n8n" in sys.argv:
        sys.exit(testar_n8n())
    if "--colunas" in sys.argv:
        colunas()
        sys.exit(0)
    if "--jev-tabela" in sys.argv:
        jev_tabela()
        sys.exit(0)
    if "--jev-exemplo" in sys.argv:
        # Item de teste ANÔNIMO para fixar (pin) na saída de "Jev: mascarar e montar pedido" no editor e
        # rodar só o ramo: confere credencial, Jev e tabela sem nenhuma resposta real de lead.
        print(json.dumps(rodar_js(JEV_FUNCOES_JS + "\nconsole.log(JSON.stringify({ pedido: pedidoJev("
                                  "mascarar('Não temos interesse, obrigado. Liga no (27) 3322-1100')),"
                                  " registro: { lead_hash: 'teste', planilha: 'teste', n_mensagens: 1, resposta_em: '',"
                                  " tipo_gemini: 'negativa' }, inicio_ms: null }));"), ensure_ascii=False, indent=2))
        sys.exit(0)
    auth = credencial()
    telefones(auth)
    conversa(auth)
    resposta(auth)
    try:
        colunas()
    except Exception as e:  # noqa: BLE001 — os fluxos já estão no ar; a coluna pode vir depois
        print(f"colunas não criadas ({e}); rode de novo com --colunas quando a credencial Google estiver ok")
