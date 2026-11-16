var PrumoClassificacaoGratuita;
(() => {
  // src/operations/mensagem-automatica.ts
  function textoDeMensagemAutomatica(texto, papel) {
    const s = texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
    if (papel === "robo") return true;
    const explicita = /\b(?:mensagem automatica|atendimento automatico|digite (?:o numero|[0-9])|escolha uma (?:das )?opc(?:ao|oes))\b/.test(s) || /\[opcoes:/.test(s);
    const respondeuAoContato = /\b(?:mas|contudo|porem)\b.{0,160}\b(?:ja (?:temos|tenho|possuimos|utilizamos|usamos)|utilizamos um sistema|nao (?:temos interesse|tenho interesse|oferecemos atendimento)|somos uma instituicao)\b/.test(s);
    if (respondeuAoContato && !explicita) return false;
    const aviso = s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ").replace(/\s+/g, " ").trim();
    const recepcao = /^(?:ola[!,. ]*)?(?:iremos|vamos) (?:te |lhe )?atender em instantes[!. ]*$/.test(aviso);
    const ausencia = /^(?:ola[!,. ]*)?agradecemos sua mensagem[!. ]+nao estamos disponiveis no momento[, ]+mas responderemos assim que possivel[!. ]*$/.test(aviso);
    const hora = String.raw`\d{1,2}(?::\d{2}|h(?:\d{2})?)?`;
    const expediente = new RegExp(String.raw`^atendimento de segunda(?:-feira)? (?:a|ate) sexta(?:-feira)? das ${hora} (?:as|a) ${hora}[!. ]*(?:ligacoes em caso (?:de )?urgencia[!. ]*)?(?:instagram\s+@[a-z0-9_.]+\s+)?respostas por ordem de contato[!. ]*fora do horario[, ]+feriados e finais de semana[, ]+somente urgencia[!. ]*$`).test(aviso);
    if (recepcao || ausencia || expediente) return true;
    return explicita || /\b(?:seja(?:m)? (?:muito )?bem[ -]*vind[oa]s?|recebemos sua mensagem|em breve[, ]+(?:um|uma|nossa equipe|responderemos|retornaremos)|logo (?:voce )?sera atendid[oa]|horario de atendimento|nosso whatsapp esta fora do ar)\b/.test(s) || /\bagradece(?:mos)? (?:o )?(?:seu )?contato\b/.test(s) && /\b(?:como podemos ajudar|como posso (?:te )?ajudar|em que podemos|deixe|informe|aguarde|retornaremos|retornarei|orcamento)\b/.test(s) || /\b(?:horario de funcionamento|horario comercial)\b/.test(s) && /\b(?:retornaremos|entraremos em contato|assim que|agradece|segunda|sexta|seg\.)\b/.test(s);
  }

  // src/operations/classificacao-resposta.ts
  var VERSAO_CLASSIFICACAO_RESPOSTA = "respostas-2026-11-06-contexto";
  var normalizar = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  var textoDe = (m) => m.texto ?? m.trecho ?? "";
  var normalizarResposta = (t) => normalizar(t).replace(/^(?:\*\[[^\]]+\]\*|\*[\p{L}][^*\n]{0,100}\*:?)\s*/u, "");
  var ultimoQue = (xs, f) => [...xs].reverse().find(f);
  var automatico = (m) => textoDeMensagemAutomatica(textoDe(m), m.papel);
  var afirmacao = /^(?:ola[,.! ]*|bom dia[,.! ]*|boa tarde[,.! ]*)?(?:sim|claro|ok|pode(?: sim)?|pode ser|sou eu|eu mesmo|eu mesma|pode falar(?: por aqui)?(?:,? sim)?|sim,? pode falar|sim,? (?:conversa|fala) com o responsavel)[.! ]*$/;
  var acesso = /(?:sou|eu sou|sou eu|eu mesmo|eu mesma|sim,? (?:conversa|fala) com)\b.{0,30}\b(?:responsavel|coordenador|coordenadora)|^(?:sou eu|eu mesmo|eu mesma)(?:[,.! ]+pode falar)?[.! ]*$|(?:vou|irei) (?:te )?(?:passar|encaminhar)|contato d[oa] responsavel|pode falar por aqui|segue (?:o )?contato|contato dele|(?:ele|ela) e a pessoa que cuida|(?:enviando|enviar|encaminhar) (?:para|pelo) (?:nosso |o )?e-?mail/;
  var perguntaDeAcesso = /(?:consigo|posso) falar|(?:quem|o|a) (?:responsavel|coordena|coordenador|decide)|(?:quem|voce) (?:cuida|organiza)|com quem falo/;
  var perguntaDePermissao = /(?:posso|poderia|podemos|quer que eu)\b.{0,100}\b(?:mandar|enviar|mostrar)|(?:posso|poderia) (?:preparar|montar) uma demonstracao|(?:te|lhe) (?:mando|envio)\b.{0,80}\?/;
  var permissao = /^(?:claro[,! ]*)?(?:pode(?:m)?(?: sim)?(?: me| nos)? (?:mandar|enviar|mostrar)|manda(?: ai| o link| o video)?|envie(?: o link| o video)?)/;
  var positivo = /quanto (?:custa|fica)|qual (?:e )?o (?:preco|valor)|(?:quais|como sao) (?:os )?(?:precos|valores)|como (?:isso |ele |o sistema |a plataforma )?funciona|tenho interesse|temos interesse|quero (?:contratar|comprar|implantar)|queremos (?:contratar|comprar|implantar)|precisamos (?:disso|de um sistema|organizar)|me explica(?: melhor)? como/;
  var pedirMaterial = /(?:manda|envia|mande|envie|mandar|enviar|ver|conhecer)\b.{0,50}\b(?:video|link|demonstracao|material|sistema|plataforma)/;
  var negacaoTruncada = /\b(?:mas|mais)\s+['’]ao\s+(?:tenho|temos)\s+interesse\b/;
  var recusa = /nao (?:tenho|temos) interesse|nao (?:estou|estamos|estao) interessad[oa]s?\b|nao (?:quero|queremos|preciso|precisamos)|nao[, ]+obrigad|sem interesse|nao (?:me )?(?:mande|envie|contate)|nao (?:precisa|precisam) (?:me |nos )?(?:mandar|enviar|mostrar) (?:mais )?nada\b|pare de|vou deixar(?: amigo)?|nao autorizo/;
  var exclusaoExplicita = /(?:^|[.!?;]\s*|\b(?:por favor|por gentileza)[,.]?\s+)(?:apague|exclua|remova|retire)\s+(?:(?:o|esse|este|meu|nosso)\s+)*(?:numero|telefone|contato|dados)\b|^(?:por favor[,.]?\s+)?me (?:tire|retire|remova) (?:da|dessa|desta) lista\b/;
  var cortesia = /^(?:de nada+|por nada|obrigad[oa]+|valeu|ok|certo|tudo bem|bom dia|boa tarde|boa noite|ola|oi)[!.,\s]*$/;
  var numeroErrado = /\b(?:numero (?:esta |e )?errado|alguma coisa errada no numero|nao tenho nada a ver com)\b/;
  var fornecedorAtual = /ja (?:tenho|temos) (?:site|agencia|um sistema|sistema)/;
  var troca = /(?:quero|queremos|preciso|precisamos|pretendo|pretendemos|gostaria de|gostariamos de|estou pensando em|estamos pensando em)\b.{0,55}\b(?:trocar|mudar|substituir|outro|outra)|(?:trocar|mudar|substituir)\b.{0,40}\b(?:sistema|fornecedor|agencia|site)/;
  var sinalComercial = (t) => !recusa.test(t) && !negacaoTruncada.test(t) && (positivo.test(t) || troca.test(t));
  var timing = /estou (?:no transito|ocupad|apertad)|essa semana estou|vou (?:ver|conversar|avaliar|verificar)|nao (?:decido|resolvo) sozinh/;
  var pedidoDeConversa = /\b(?:agende|agenda|marque)\b.{0,70}\bcomigo\b.{0,45}\b(?:bate-papo|conversa|reuniao|demonstracao)|\b(?:quero|gostaria de|podemos) (?:agendar|marcar)\b.{0,65}\b(?:conversa|reuniao|bate-papo|demonstracao)/;
  function classificarResposta(lead, mensagens, agora = Infinity) {
    const fonte = lead.respostaFonte ?? lead.resposta;
    const enviado = Date.parse(lead.marcos.enviado ?? "");
    const inicio = Number.isFinite(enviado) ? enviado : -Infinity;
    const resumo = lead.conversa;
    const ctx = [...mensagens ?? resumo?.recentes ?? (resumo?.ultima ? [resumo.ultima] : [])].filter((m) => Number.isFinite(Date.parse(m.em)) && Date.parse(m.em) <= agora).sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
    const entradas = ctx.filter((m) => m.direcao === "entrada" && Date.parse(m.em) >= inicio);
    const emFonte = Date.parse(fonte?.em ?? lead.marcos.respondeu ?? "");
    const dataHumanaValida = Number.isFinite(emFonte) && emFonte >= inicio && emFonte <= agora;
    const indicacaoHumana = fonte ? fonte.tipo !== "bot" && (!fonte.em || dataHumanaValida) : dataHumanaValida;
    const papelHumano = entradas.some((m) => (m.papel === "recepcao" || m.papel === "gente") && !automatico(m));
    const ultima = entradas.at(-1);
    const marcada = ultimoQue(entradas, (m) => Number.isFinite(emFonte) && Math.abs(Date.parse(m.em) - emFonte) < 2e3) ?? ultimoQue(entradas, (m) => Boolean(fonte?.trecho && normalizar(textoDe(m)).includes(normalizar(fonte.trecho))));
    const fonteHumana = indicacaoHumana && !(marcada && automatico(marcada));
    let candidata = fonteHumana && ultima && automatico(ultima) ? marcada : ultima ?? marcada;
    const recusou = ultimoQue(entradas, (m) => !automatico(m) && (recusa.test(normalizarResposta(textoDe(m))) || exclusaoExplicita.test(normalizarResposta(textoDe(m)))));
    if (candidata && recusou && Date.parse(recusou.em) < Date.parse(candidata.em) && cortesia.test(normalizarResposta(textoDe(candidata)))) candidata = recusou;
    const encaminhou = ultimoQue(entradas, (m) => !automatico(m) && acesso.test(normalizarResposta(textoDe(m))));
    if (candidata && encaminhou && Date.parse(encaminhou.em) < Date.parse(candidata.em) && cortesia.test(normalizarResposta(textoDe(candidata)))) candidata = encaminhou;
    const divergencia = ultimoQue(entradas, (m) => !automatico(m) && numeroErrado.test(normalizarResposta(textoDe(m))));
    if (divergencia) candidata = divergencia;
    if (candidata && /^\[(?:contato|cartao de contato)\]$/.test(normalizar(textoDe(candidata)))) {
      const cartao = candidata;
      candidata = ultimoQue(entradas, (m) => m !== cartao && Date.parse(m.em) <= Date.parse(cartao.em) && Date.parse(cartao.em) - Date.parse(m.em) <= 12e4 && acesso.test(normalizar(textoDe(m)))) ?? candidata;
    }
    const posteriorAoBot = fonte?.tipo === "bot" && candidata && Number.isFinite(emFonte) && Date.parse(candidata.em) > emFonte + 2e3 && !automatico(candidata);
    const ehRobo = candidata ? automatico(candidata) || fonte?.tipo === "bot" && !posteriorAoBot && candidata.papel !== "recepcao" : fonte?.tipo === "bot";
    const houveRespostaHumana = fonteHumana || papelHumano;
    const trecho = candidata ? textoDe(candidata) : fonte?.trecho ?? "";
    const t = normalizarResposta(trecho);
    const index = candidata ? ctx.indexOf(candidata) : -1;
    const pergunta = ultimoQue(index >= 0 ? ctx.slice(0, index) : ctx.filter((m) => Date.parse(m.em) <= emFonte), (m) => m.direcao === "saida");
    const q = normalizar(pergunta ? textoDe(pergunta) : "");
    const contatoIndicado = /(?:\b(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}\b|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/.test(t) && (/\b(?:terreo|piso|loja \d|fone|telefone|ramal|contato)\b/.test(t) || perguntaDeAcesso.test(q) || entradas.some((m) => m !== candidata && /\bshopping\b/.test(normalizar(textoDe(m)))));
    const historica = ultimoQue(entradas, (m) => m !== candidata && !automatico(m) && (m.papel === "recepcao" || m.papel === "gente" || fonteHumana) && sinalComercial(normalizar(textoDe(m))));
    const interesseHistorico = historica ? { trecho: textoDe(historica).slice(0, 280), em: historica.em } : fonteHumana && fonte?.trecho && candidata && fonte.em && Date.parse(fonte.em) < Date.parse(candidata.em) && sinalComercial(normalizar(fonte.trecho)) ? { trecho: fonte.trecho.slice(0, 280), em: fonte.em } : void 0;
    const base = {
      versao: VERSAO_CLASSIFICACAO_RESPOSTA,
      houveRespostaHumana,
      leituraConfirmada: Boolean(lead.marcos.visto) || lead.leitura === "viu",
      ...interesseHistorico ? { interesseHistorico } : {},
      ...trecho ? { evidencia: { trecho: trecho.slice(0, 280), ...candidata?.em || fonte?.em ? { em: candidata?.em ?? fonte?.em } : {}, ...pergunta ? { perguntaAnterior: textoDe(pergunta).slice(0, 280) } : {} } } : {}
    };
    const sair = (classe, motivo, materialSolicitado = false, revisar = false) => ({ ...base, classe, motivo, materialSolicitado, revisar });
    const pediuExcluirMaterial = fonte?.tipo === "negativa" && /\b(?:se puder|por favor|por gentileza) (?:excluir|apagar|remover) (?:esse |este |o |meu |meus )?(?:conteudo|material|numero|dados|contato)\b/.test(t);
    if (fonte?.tipo === "exclusao" || pediuExcluirMaterial) return sair("exclusao", "H\xE1 pedido de exclus\xE3o de conte\xFAdo ou contato; conferir o escopo com uma pessoa e preservar a restri\xE7\xE3o e o hist\xF3rico.");
    if (divergencia) return sair("pendente", "O interlocutor informou que o n\xFAmero n\xE3o pertence ao contato procurado. Conferir a identidade e n\xE3o abordar outro n\xFAmero automaticamente.", false, true);
    if (ehRobo && !fonteHumana && !papelHumano) return sair("robo", "H\xE1 resposta autom\xE1tica; isso n\xE3o comprova leitura por uma pessoa.");
    if (!fonte && lead.marcos.respondeu && !dataHumanaValida) return sair("pendente", "O marco de resposta tem data incompat\xEDvel com o envio ou a observa\xE7\xE3o; conferir a fonte.", false, true);
    if (!fonte && !entradas.length && !houveRespostaHumana) return Number.isFinite(enviado) ? sair("silencio", base.leituraConfirmada ? "H\xE1 recibo de leitura, sem resposta registrada; a inten\xE7\xE3o \xE9 desconhecida." : "Sem resposta nem leitura confirmada; n\xE3o significa que ignorou.") : sair("nao-contatado", "Sem envio registrado; fora do denominador de respostas.");
    if (posteriorAoBot && !papelHumano) return sair("pendente", "H\xE1 entrada posterior ao rob\xF4 ainda sem classifica\xE7\xE3o confirmada; conferir o encaminhamento ou a resposta.", false, true);
    if (negacaoTruncada.test(t)) return sair("recusa", "Nega\xE7\xE3o truncada ap\xF3s mas/mais: leitura contextual de prov\xE1vel recusa, sem interesse confirmado. Preservar a fala e revisar a interpreta\xE7\xE3o antes de qualquer retomada.", false, true);
    if (recusa.test(t)) return sair("recusa", "A fala cont\xE9m recusa expl\xEDcita; permiss\xE3o anterior n\xE3o confirma interesse atual.");
    if (fornecedorAtual.test(t) && !sinalComercial(t)) return sair("recusa", "A pessoa informou que j\xE1 tem uma solu\xE7\xE3o, sem abertura comercial registrada.");
    if (fonte?.tipo === "negativa" && sinalComercial(t)) return sair("interesse", "H\xE1 inten\xE7\xE3o comercial expl\xEDcita apesar da negativa registrada; conferir a diverg\xEAncia sem reabrir a conversa automaticamente.", pedirMaterial.test(t), true);
    if (fonte?.tipo === "negativa" && !positivo.test(t) && (acesso.test(t) || contatoIndicado || cortesia.test(t) || /^(?:agradeco|agradecemos|obrigad[oa]) (?:o |pelo |seu )?contato[.!\s]*$/.test(t)))
      return sair("pendente", "A fonte registra recusa, mas a evid\xEAncia \xE9 agradecimento ou encaminhamento. Conferir a classifica\xE7\xE3o sem reabrir o contato automaticamente.", false, true);
    if (fonte?.tipo === "negativa") return timing.test(t) ? sair("pendente", "H\xE1 indica\xE7\xE3o de timing ou avalia\xE7\xE3o; revisar a negativa sem reabrir o contato automaticamente.", false, true) : sair("recusa", "Recusa registrada na fonte; preservar a restri\xE7\xE3o de contato.");
    if (!houveRespostaHumana) return sair("pendente", "Existe entrada sem autoria/classifica\xE7\xE3o suficiente; aus\xEAncia de papel n\xE3o comprova humanidade.", false, true);
    if (exclusaoExplicita.test(t)) return sair("exclusao", "A pessoa pediu explicitamente remover contato ou dados; preservar a restri\xE7\xE3o e conferir o escopo, sem afirmar exclus\xE3o executada.");
    if (/^\[audio(?: \d+s)?\](?:\s*)$|^\[audio nao transcrito\]$/.test(t)) return sair("pendente", "\xC1udio sem transcri\xE7\xE3o: conte\xFAdo desconhecido.", false, true);
    if (sinalComercial(t)) return sair("interesse", "H\xE1 pergunta comercial ou inten\xE7\xE3o expl\xEDcita sobre a oferta; ainda n\xE3o confirma qualifica\xE7\xE3o, aceite ou pagamento.", pedirMaterial.test(t));
    if (pedidoDeConversa.test(t)) return sair("conversa", "A pessoa pediu uma conversa; conferir retomadas posteriores antes de sugerir hor\xE1rio. N\xE3o h\xE1 reuni\xE3o aceita nem compra confirmada.");
    if (acesso.test(t) || contatoIndicado || perguntaDeAcesso.test(q) && afirmacao.test(t)) return sair("acesso", "A fala confirma identidade, acesso ou encaminhamento; n\xE3o confirma interesse na oferta.");
    if (fonte?.tipo === "licenca" || permissao.test(t) || perguntaDePermissao.test(q) && afirmacao.test(t)) return sair("permissao", "Autorizou receber o material; isso n\xE3o confirma necessidade ou inten\xE7\xE3o de compra.", true);
    if (pedirMaterial.test(t) || /\b(?:gostei|interessante|achei (?:bem )?legal)\b/.test(t)) return sair("curiosidade", "H\xE1 curiosidade ou aprecia\xE7\xE3o; necessidade e inten\xE7\xE3o comercial n\xE3o est\xE3o confirmadas.", pedirMaterial.test(t));
    if (interesseHistorico && afirmacao.test(t)) return sair("neutra", "A confirma\xE7\xE3o atual n\xE3o apaga o interesse comercial anterior; conservar o pr\xF3ximo passo e as condi\xE7\xF5es registradas.");
    if (fonte?.tipo === "interesse" && (!t || afirmacao.test(t))) return sair("pendente", "R\xF3tulo antigo de interesse sem pergunta ou conte\xFAdo suficiente para distinguir acesso de permiss\xE3o.", false, true);
    return sair("neutra", "Resposta humana sem sinal comercial expl\xEDcito; manter o contexto e o combinado.");
  }

  // classificador-n8n.js
  PrumoClassificacaoGratuita = { classificarResposta };
})();
