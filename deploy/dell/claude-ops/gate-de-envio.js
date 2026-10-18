// Gate de pre-envio da 1a mensagem do Balcao (18/10/2026). Vai entre o site-mensagem.js e o
// balcao-cruzar.js no no do n8n (site-antes-da-venda.py: codigo_do_balcao), sem modulo nem
// dependencia: as funcoes ficam no escopo do no. Nao tem flag aqui; o modo (desligado, avisar ou
// bloquear) e a constante GATE_DE_ENVIO do balcao-cruzar.js.
//
// E a COPIA, para o tipo "primeiro" (sem link, sem conversa), do gate PURO em TypeScript que ja
// protege o copiloto e o vendedor do Telegram (server/gate-de-envio.ts, ideia do Harvey): uma
// conferencia sem modelo, sobre o texto ja montado. As listas (MARCAS, FRASES_PROIBIDAS, limites,
// precos abertos) NAO podem ser diferentes das de la: server/gate-de-envio-balcao.test.ts compara
// as regex, os limites, os precos e o resultado das duas sobre os mesmos textos, e falha se
// divergirem. Mudou uma regra? Mude as duas.
//
// Nunca reescreve o texto e nunca envia nada: devolve a lista de problemas
// [{ codigo, trecho?, motivo }], vazia = pode sair. Fora do que a 1a mensagem tem: destinatario
// (o wa.me do Balcao sai do mesmo telefone do registro), tamanho/links de outros tipos e "conforme
// conversamos" so existe para quem nao conversou, que e sempre o caso aqui.

// 1a mensagem: pedido de licenca, sem link. Maior texto de hoje 343 caracteres (A com o detalhe).
const GATE_LIMITE_PRIMEIRO = { caracteres: 600, links: 0 };

// Os "R$" que podem aparecer: os precos abertos do cardapio (src/operations/copiloto.ts PRECOS_ABERTOS).
const GATE_PRECOS_ABERTOS = ['R$ 690', 'R$ 39', 'R$ 590', 'R$ 390', 'R$ 790'];

const GATE_MARCAS = [
  { regex: /\{\{[^}\n]*\}\}/ },
  { regex: /\$\{[^}\n]*\}/ },
  { regex: /\{[^{}\n]{1,40}\}/ },
  // %s, %d e %(nome)s de formatacao; "50%" e "100% dos" nao casam (exige letra colada e nao digito antes).
  { regex: /(?<![\w%])%(?:\([A-Za-z_]+\))?[sd]\b/ },
  { regex: /<[A-Za-z_][A-Za-z0-9_ ]{1,30}>/ },
  { regex: /\[object Object\]/ },
  { regex: /\[[^\]\n]{1,60}\]/, colchete: true },
  { regex: /\b(?:undefined|null|NaN)\b/ },
  // NOME_CONTATO, RAIO_X, O_A: o nome de variavel que vazou.
  { regex: /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/ },
];

// Regex sobre o texto normalizado (minusculo, sem acento).
const GATE_FRASES_PROIBIDAS = [
  { regex: /espero que (?:voce |vc |tudo )?(?:esteja|estejam)\b|espero que (?:esta|essa) mensagem|espero que (?:este|esse) (?:e-?mail|contato)/, motivo: 'abertura de texto de IA' },
  { regex: /gostaria de (?:entrar em contato|me apresentar|apresentar)/, motivo: 'abertura de texto de IA' },
  { regex: /venho (?:por meio|atraves|por esta|por essa)/, motivo: 'abertura de ofício' },
  { regex: /\bpassando (?:aqui )?para\b/, motivo: 'abertura de vendedor' },
  { regex: /\b(?:prezad[oa]s?|estimad[oa]s?)\b/, motivo: 'tratamento de ofício' },
  { regex: /\b(?:atenciosamente|cordialmente)\b/, motivo: 'fecho de ofício' },
  { regex: /nao hesite em|fico a disposicao para qualquer|qualquer duvida estou a disposicao/, motivo: 'fecho de texto de IA' },
  { regex: /aqui esta a mensagem|segue a mensagem|mensagem sugerida|como (?:uma )?(?:ia|inteligencia artificial|modelo de linguagem|assistente virtual)\b/, motivo: 'sobra de texto de IA' },
  { regex: /numero limitado|(?:so|apenas) 2 minutos|oferta imperdivel/, motivo: 'gatilho de vendedor' },
  { regex: /depende do dono|centralizador|merito seu/, motivo: 'fala que o PRUMO evita' },
];

const GATE_CONVERSA_QUE_NAO_HOUVE = /\b(?:conforme|como) (?:conversamos|combinamos|falamos|combinado)\b|conforme nossa conversa/;
const GATE_EMOJI = /\p{Extended_Pictographic}/u;
const GATE_LINK = /(?:https?:\/\/|www\.|wa\.me\/)\S+/gi;

function gateNormalizar(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

// Todo "R$ ..." de um texto, como aparece ("R$ 2.400").
function gatePrecosNoTexto(texto) {
  return texto.match(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d+)?/g) || [];
}

// Os valores que nao podem ir ao WhatsApp (a regra do copiloto, precosProibidos).
function gatePrecosProibidos(mensagem, permitidos) {
  const soDigitos = (p) => p.replace(/\D/g, '');
  const abertos = new Set((permitidos || GATE_PRECOS_ABERTOS).map(soDigitos));
  const comCifrao = gatePrecosNoTexto(mensagem).filter((p) => !abertos.has(soDigitos(p)));
  // "2.400 reais", "1500 reais", "2 mil reais": valor sem o R$ tambem conta.
  const achados = mensagem.match(/\b\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*(?:mil\s+)?reais\b/gi) || [];
  const porExtenso = achados.filter((p) => /mil/i.test(p) || !abertos.has(soDigitos(p.replace(/,\d+/, ''))));
  return [...comCifrao, ...porExtenso];
}

function gateProblemasDoNome(nome, texto) {
  const n = String(nome).trim();
  if (!n) return [{ codigo: 'nome_invalido', motivo: 'o nome da empresa está vazio' }];
  const lixo = /[\u0000-\u001f<>{}[\]|\\]|https?:|www\.|@|\b(?:undefined|null|NaN)\b/i.test(n) || !/\p{L}{2}/u.test(n);
  if (lixo) return [{ codigo: 'nome_invalido', trecho: n.slice(0, 40), motivo: 'o nome da empresa tem lixo' }];
  const palavras = gateNormalizar(n).split(/[\s,.;:-]+/).filter((p) => p.length >= 3);
  const repetida = palavras.find((p, i) => i > 0 && p === palavras[i - 1]);
  if (repetida) return [{ codigo: 'nome_invalido', trecho: n.slice(0, 40), motivo: 'o nome da empresa repete a palavra' }];
  const vezes = gateNormalizar(texto).split(gateNormalizar(n)).length - 1;
  if (vezes > 2) return [{ codigo: 'nome_invalido', trecho: n.slice(0, 40), motivo: 'o nome da empresa aparece demais na mensagem' }];
  return [];
}

// PURA. A 1a mensagem ja montada (e o nome da empresa, se vier) -> os problemas, na ordem do gate
// em TypeScript: vazio, marca, frase, emoji, tamanho, links, R$, nome.
function conferirPrimeiraMensagem(texto, nome) {
  const problemas = [];
  const t = typeof texto === 'string' ? texto : '';
  const limpo = t.trim();

  if (!limpo) {
    problemas.push({ codigo: 'vazio', motivo: 'a mensagem está vazia' });
  } else {
    // (a) marca que ninguem preencheu
    const marcas = new Set();
    for (const { regex } of GATE_MARCAS) {
      for (const m of limpo.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'))) marcas.add(m[0]);
    }
    for (const m of marcas) problemas.push({ codigo: 'marca_nao_renderizada', trecho: m.slice(0, 40), motivo: 'marca sem preencher: ' + m.slice(0, 40) });

    // (b) frase proibida e emoji
    const norm = gateNormalizar(limpo);
    for (const { regex, motivo } of GATE_FRASES_PROIBIDAS) {
      const achou = regex.exec(norm);
      if (achou) problemas.push({ codigo: 'frase_proibida', trecho: achou[0].slice(0, 40), motivo: motivo + ': “' + achou[0].slice(0, 40) + '”' });
    }
    const conversa = GATE_CONVERSA_QUE_NAO_HOUVE.exec(norm);
    if (conversa) problemas.push({ codigo: 'frase_proibida', trecho: conversa[0], motivo: 'fala de uma conversa que não houve: “' + conversa[0] + '”' });
    const emoji = GATE_EMOJI.exec(limpo);
    if (emoji) problemas.push({ codigo: 'emoji', trecho: emoji[0], motivo: 'emoji (o tom do PRUMO não usa)' });

    // (c) tamanho e (d) links
    if (limpo.length > GATE_LIMITE_PRIMEIRO.caracteres) {
      problemas.push({ codigo: 'longa_demais', motivo: limpo.length + ' caracteres, o máximo é ' + GATE_LIMITE_PRIMEIRO.caracteres });
    }
    const links = limpo.match(GATE_LINK) || [];
    if (links.length > GATE_LIMITE_PRIMEIRO.links) {
      const extra = links[GATE_LIMITE_PRIMEIRO.links];
      problemas.push({ codigo: 'links_demais', trecho: extra === undefined ? undefined : extra.slice(0, 60), motivo: links.length + ' links, o máximo é ' + GATE_LIMITE_PRIMEIRO.links });
    }

    // (g) "R$" fora dos permitidos
    const fora = gatePrecosProibidos(limpo);
    if (fora.length) problemas.push({ codigo: 'preco_fora_do_cardapio', trecho: fora[0], motivo: 'valor fora do cardápio: ' + fora.join(', ') });
  }

  // (e) o nome da empresa
  if (nome !== undefined) problemas.push(...gateProblemasDoNome(nome, limpo));
  return problemas;
}

// Os motivos numa frase so, para a coluna gate_de_envio (no maximo 300 caracteres).
function resumoDoGate(problemas) {
  const frase = problemas.map((p) => p.motivo).join('; ');
  return frase.length > 300 ? frase.slice(0, 297) + '...' : frase;
}
