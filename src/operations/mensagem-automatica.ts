/** Sinais de saudação, ausência ou menu; não comprovam atendimento humano. Sem I/O. */
export function textoDeMensagemAutomatica(texto:string,papel?:string):boolean {
  const s=texto.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim()
  if(papel==='robo')return true
  // Agradecimento em uma resposta específica não é prova de automação.
  const explicita=/\b(?:mensagem automatica|atendimento automatico|digite (?:o numero|[0-9])|escolha uma (?:das )?opc(?:ao|oes))\b/.test(s)||/\[opcoes:/.test(s)
  const respondeuAoContato=/\b(?:mas|contudo|porem)\b.{0,160}\b(?:ja (?:temos|tenho|possuimos|utilizamos|usamos)|utilizamos um sistema|nao (?:temos interesse|tenho interesse|oferecemos atendimento)|somos uma instituicao)\b/.test(s)
  if(respondeuAoContato&&!explicita)return false
  // Avisos completos de recepção/ausência/expediente, sem frase comercial extra.
  // Reconhecer o molde inteiro evita consumir uma resposta humana que apenas
  // começa com saudação ou informa seu horário e depois pergunta pela oferta.
  const aviso=s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,' ').replace(/\s+/g,' ').trim()
  const recepcao=/^(?:ola[!,. ]*)?(?:iremos|vamos) (?:te |lhe )?atender em instantes[!. ]*$/.test(aviso)
  const ausencia=/^(?:ola[!,. ]*)?agradecemos sua mensagem[!. ]+nao estamos disponiveis no momento[, ]+mas responderemos assim que possivel[!. ]*$/.test(aviso)
  const hora=String.raw`\d{1,2}(?::\d{2}|h(?:\d{2})?)?`
  const expediente=new RegExp(String.raw`^atendimento de segunda(?:-feira)? (?:a|ate) sexta(?:-feira)? das ${hora} (?:as|a) ${hora}[!. ]*(?:ligacoes em caso (?:de )?urgencia[!. ]*)?(?:instagram\s+@[a-z0-9_.]+\s+)?respostas por ordem de contato[!. ]*fora do horario[, ]+feriados e finais de semana[, ]+somente urgencia[!. ]*$`).test(aviso)
  if(recepcao||ausencia||expediente)return true
  return explicita
    ||/\b(?:seja(?:m)? (?:muito )?bem[ -]*vind[oa]s?|recebemos sua mensagem|em breve[, ]+(?:um|uma|nossa equipe|responderemos|retornaremos)|logo (?:voce )?sera atendid[oa]|horario de atendimento|nosso whatsapp esta fora do ar)\b/.test(s)
    ||/\bagradece(?:mos)? (?:o )?(?:seu )?contato\b/.test(s)&&/\b(?:como podemos ajudar|como posso (?:te )?ajudar|em que podemos|deixe|informe|aguarde|retornaremos|retornarei|orcamento)\b/.test(s)
    ||/\b(?:horario de funcionamento|horario comercial)\b/.test(s)&&/\b(?:retornaremos|entraremos em contato|assim que|agradece|segunda|sexta|seg\.)\b/.test(s)
}
