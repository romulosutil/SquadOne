/** Apenas regras locais já usadas no CRM. Sem rede, modelo ou ferramenta de envio. */
function classificarLoteGratuito(m) {
  const entradas = Array.isArray(m?.mensagens) ? m.mensagens : [];
  const contexto = Array.isArray(m?.contexto) ? m.contexto : [];
  const normalizarPapel = p => /rob[oô]/i.test(String(p || '')) ? 'robo' : /recep[cç][aã]o/i.test(String(p || '')) ? 'recepcao' : 'gente';
  const mensagens = [
    ...contexto.map(x => ({direcao:x.quem === 'Rômulo' || x.direcao === 'saida' ? 'saida' : 'entrada',em:x.em,texto:x.texto || '',papel:normalizarPapel(x.papel)})),
    ...entradas.map(x => ({direcao:'entrada',em:x.em,texto:x.texto || '',papel:normalizarPapel(x.papel)})),
  ];
  const vistos = new Set();
  const unicas = mensagens.filter(x => {
    const key = JSON.stringify([x.direcao,x.em,x.texto]);
    if(vistos.has(key))return false;vistos.add(key);return true;
  });
  const c = PrumoClassificacaoGratuita.classificarResposta({marcos:{}},unicas);
  const tipo = ({recusa:'negativa',exclusao:'exclusao',robo:'bot',interesse:'interesse',permissao:'licenca'})[c.classe] || 'neutra';
  return {text:JSON.stringify({tipo,classe:c.classe,revisar:c.revisar,metodo:'regras-locais-custo-zero'}),metodo:'regras-locais-custo-zero'};
}
