/** Textos aprovados em prumo-simples.py e prumo-ofertas.json. Só monta o rascunho. */
export function mensagemDoConvite(produto: string, empresa: string, segmento: string, agora: Date): string {
  let nome = empresa.trim()
  for (let i = 0; i < 2; i++) nome = nome.replace(/[\s,.-]+(ltda|me|epp|eireli|s\.?\/?a\.?)\.?$/i, '').trim()
  if (nome === nome.toUpperCase() && /\p{Lu}{4}/u.test(nome)) nome = nome.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/ (D[aeo]s?|E|Para|Em) /g, m => m.toLowerCase())
  nome ||= 'empresa'
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora))
  const ola = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  if (produto === 'iris') return `${ola}! Aqui é do Prumo. Trabalhamos com o Iris, um sistema para clínicas de terapia em que as anotações de cada sessão viram o dossiê da reavaliação, pronto para o convênio.\n\nConsigo falar por aqui com quem coordena a ${nome}?`
  if (produto === 'estampa') return `${ola}! Aqui é do Prumo. Estamos conversando com estamparias sobre um jeito de organizar os pedidos que chegam pelo WhatsApp: arte, tamanhos e prazo numa ficha só, sem se perder na conversa.\n\nConsigo falar por aqui com o responsável pela ${nome}?`
  const seg = segmento.trim().toLowerCase()
  const distribuidora = /^distribuidoras? /.test(seg)
  const publico = distribuidora ? seg.replace(/^distribuidoras? /, 'distribuidoras ') : 'empresas como a de vocês'
  const areas = !distribuidora ? 'do dia a dia' : /autope/.test(seg) ? 'de orçamento, preço e compras' : /constru/.test(seg) ? 'de preço, desconto e crédito' : /aliment|bebida/.test(seg) ? 'de preço, prazo e cobrança' : 'de preço, crédito e entregas'
  return `${ola}! Aqui é o Rômulo, do Prumo. Ajudo donos de ${publico} a passar para a equipe as decisões ${areas} que hoje dependem só deles.\n\nConsigo falar com o responsável pela ${nome} por aqui?`
}
