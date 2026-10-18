import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { montarDossie, type LeadDoCopiloto } from './operations/copiloto.ts'
import {
  audioDaMensagem, levouMaterial, papelDaMensagem, pedeMaterial, textoParaATela, textoParaOModelo, type PapelDaMensagem,
} from './operations/marcadores-da-conversa.ts'
import { anotacoesAMao, linhaDaConversa } from './operations/proxima-venda.ts'
import { quemRespondeu, quisVer, respondeuDeGente } from './operations/resultados.ts'
import type { CrmLead, CrmResumoDaConversa } from './operations/types.ts'

// O caso Baobá (17/10/2026): o áudio que ninguém ouviu, o "pode enviar sim" da recepção a "posso
// mandar o vídeo?" (licença, não interesse) e o vídeo mandado como mídia. Tabelas das regras PURAS.
// Tudo fixture: nenhuma conversa real.

const AGORA = Date.parse('2026-10-17T15:00:00Z')
const horas = (n: number) => new Date(AGORA - n * 3600_000).toISOString()

describe('papelDaMensagem: quem escreveu, pelo campo gravado ou pelo texto', () => {
  const CASOS: Array<[string, string, unknown, PapelDaMensagem | undefined]> = [
    ['assinatura de atendente no começo', '*[Patricia Adriano]* CLaro, pode enviar sim.', undefined, 'recepcao'],
    ['menu do atendimento', '[Atendimento] Olá! Escolha uma opção: 1 - Agendar', undefined, 'robo'],
    ['bot', '[Bot Clínica] Em breve retornaremos', undefined, 'robo'],
    ['caixa e espaço não importam', '  [atendimento automático] fora do horário', undefined, 'robo'],
    ['gente', 'pode mandar sim', undefined, undefined],
    ['colchete no meio não é assinatura', 'oi *[Patricia]* aqui', undefined, undefined],
    ['áudio é gente', '[áudio 27s]', undefined, undefined],
    ['o campo gravado manda', 'pode mandar sim', 'recepcao', 'recepcao'],
    ['o campo gravado manda sobre o texto', '*[Patricia]* oi', 'robo', 'robo'],
    ['valor gravado fora do contrato cai no texto', '*[Patricia]* oi', 'gerente', 'recepcao'],
  ]
  for (const [nome, texto, gravado, esperado] of CASOS) it(nome, () => assert.equal(papelDaMensagem(texto, gravado), esperado))
})

describe('papelDaMensagem: a MESMA tabela do observador (Python)', () => {
  // deploy/dell/whatsapp-observador/papel-da-mensagem.casos.json, lida também pelo observador.test.py: a regex de
  // papel é uma só nos dois lados ("[Botão]" e "[Botafogo]" não são robô; "[Atendimento" sem "]" também não).
  const { casos } = JSON.parse(readFileSync(new URL('../deploy/dell/whatsapp-observador/papel-da-mensagem.casos.json', import.meta.url), 'utf8')) as
    { casos: Array<[string, PapelDaMensagem | null]> }
  it('tem casos', () => assert.ok(casos.length > 20))
  for (const [texto, esperado] of casos) {
    it(JSON.stringify(texto).slice(0, 60), () => assert.equal(papelDaMensagem(texto), esperado ?? undefined))
  }
})

describe('pedeMaterial: interesse e licença, a regra única das métricas', () => {
  const CASOS: Array<[string | undefined, boolean]> = [
    ['interesse', true], ['licenca', true], ['neutra', false], ['negativa', false], ['exclusao', false], ['bot', false], [undefined, false],
  ]
  for (const [tipo, esperado] of CASOS) it(String(tipo), () => assert.equal(pedeMaterial(tipo ? { tipo } : undefined), esperado))
})

describe('áudio: com e sem transcrição, marcador novo e antigo', () => {
  const CASOS: Array<[string, string, ReturnType<typeof audioDaMensagem>, string, string]> = [
    ['só o marcador, com duração', '[áudio 27s]', { segundos: 27, transcricao: '' }, 'áudio não ouvido (27s)',
      '[áudio de 27s que o sistema não ouviu: o conteúdo é DESCONHECIDO, não suponha que seja interesse]'],
    ['marcador antigo', '[áudio]', { transcricao: '' }, 'áudio não ouvido',
      '[áudio que o sistema não ouviu: o conteúdo é DESCONHECIDO, não suponha que seja interesse]'],
    ['sem acento', '[audio 5s]', { segundos: 5, transcricao: '' }, 'áudio não ouvido (5s)',
      '[áudio de 5s que o sistema não ouviu: o conteúdo é DESCONHECIDO, não suponha que seja interesse]'],
    ['com transcrição', '[áudio 27s] Oi, quem fala?', { segundos: 27, transcricao: 'Oi, quem fala?' }, '(áudio 27s) Oi, quem fala?',
      '[áudio de 27s, transcrito pelo sistema] Oi, quem fala?'],
    ['texto comum', 'pode mandar', null, 'pode mandar', 'pode mandar'],
  ]
  for (const [nome, texto, audio, tela, modelo] of CASOS) {
    it(nome, () => {
      assert.deepEqual(audioDaMensagem(texto), audio)
      assert.equal(textoParaATela(texto), tela)
      assert.equal(textoParaOModelo(texto), modelo)
    })
  }
  it('a máscara vale para a transcrição, nunca para a duração', () => {
    assert.equal(textoParaOModelo('[áudio 27s] meu número é (27) 99999-1234', () => 'X'), '[áudio de 27s, transcrito pelo sistema] X')
  })
})

describe('levouMaterial: mídia nossa conta como o link', () => {
  const CASOS: Array<[string, boolean]> = [
    ['[vídeo]', true], ['[video]', true], ['[vídeo] Segue o vídeo do Iris', true], ['[documento proposta.pdf]', true], ['[imagem]', true],
    ['[áudio 12s]', false], ['vou mandar o [vídeo] já', false], ['', false],
  ]
  for (const [texto, esperado] of CASOS) it(texto || '(vazio)', () => assert.equal(levouMaterial(texto), esperado))
})

const conversa = (extra: Partial<CrmResumoDaConversa>): CrmResumoDaConversa => ({
  desde: horas(100), mensagens: 4, ultima: { direcao: 'entrada', em: horas(1), trecho: 'oi' }, ...extra,
})
const lead = (extra: Partial<CrmLead>): CrmLead => ({
  id: 'iris:B', chave: 'B', empresa: 'Baobá', produto: 'iris', nicho: 'psicologia', cidade: 'Vitória', etapa: 'contato', sinal: 'respondeu-prumo',
  subEtapa: '', estadoNaPlanilha: '', leitura: 'pela-resposta', followupHoje: false, respostaNova: false, acervo: false,
  notas: 0, eventos: [], divergencias: [], links: { whatsapp: 'https://wa.me/5527999990000' }, marcos: { enviado: horas(96), respondeu: horas(72) }, ...extra,
} as CrmLead)

describe('quem respondeu: robô não é resposta; a recepção e a licença contam como "quero ver" (revisão de 17/10/2026)', () => {
  const interesse = { tipo: 'interesse', trecho: 'pode enviar sim', em: horas(24) } as CrmLead['resposta']
  const CASOS: Array<[string, Partial<CrmLead>, ReturnType<typeof quemRespondeu>, boolean, boolean]> = [
    ['sem conversa: vale a planilha', { resposta: interesse }, undefined, true, true],
    ['só o robô na conversa', { resposta: interesse, conversa: conversa({ entradas: { gente: 0, recepcao: 0, robo: 2 } }) }, 'robo', false, false],
    ['só a recepção: o interesse dela conta (o classificador já leu com o papel)', { resposta: interesse, conversa: conversa({ entradas: { gente: 0, recepcao: 1, robo: 1 } }) }, 'recepcao', true, true],
    ['só a recepção, resposta neutra: não é "quero ver"', { resposta: { ...interesse!, tipo: 'neutra' }, conversa: conversa({ entradas: { gente: 0, recepcao: 1, robo: 0 } }) }, 'recepcao', true, false],
    ['licença só da recepção conta', { resposta: { ...interesse!, tipo: 'licenca' }, conversa: conversa({ entradas: { gente: 0, recepcao: 1, robo: 0 } }) }, 'recepcao', true, true],
    ['a recepção e o lead (o áudio)', { resposta: interesse, conversa: conversa({ entradas: { gente: 1, recepcao: 1, robo: 0 } }) }, 'gente', true, true],
    ['licença de gente conta como "quero ver" (até 17/10 era gravada como interesse)', { resposta: { ...interesse!, tipo: 'licenca' }, conversa: conversa({ entradas: { gente: 1, recepcao: 0, robo: 0 } }) }, 'gente', true, true],
    ['licença só do robô não conta', { resposta: { ...interesse!, tipo: 'licenca' }, conversa: conversa({ entradas: { gente: 0, recepcao: 0, robo: 1 } }) }, 'robo', false, false],
    ['a conversa começou depois da resposta: não diz', { resposta: interesse, conversa: conversa({ desde: horas(10), entradas: { gente: 0, recepcao: 0, robo: 1 } }) }, undefined, true, true],
    ['resumo antigo, sem a contagem', { resposta: interesse, conversa: conversa({}) }, undefined, true, true],
    ['proposta conta, quem quer que tenha respondido', { etapa: 'proposta', resposta: interesse, conversa: conversa({ entradas: { gente: 0, recepcao: 1, robo: 0 } }) }, 'recepcao', true, true],
  ]
  for (const [nome, extra, quem, respondeu, quis] of CASOS) {
    it(nome, () => {
      const l = lead(extra)
      assert.equal(quemRespondeu(l), quem)
      assert.equal(respondeuDeGente(l), respondeu)
      assert.equal(quisVer(l), quis)
    })
  }
})

describe('a linha da conversa no cartão', () => {
  const CASOS: Array<[string, CrmResumoDaConversa['ultima'], string]> = [
    ['áudio que ninguém ouviu', { direcao: 'entrada', em: horas(1), trecho: '[áudio 27s]' }, 'Última mensagem: ele, há 1 h: “áudio não ouvido (27s)”'],
    ['áudio transcrito', { direcao: 'entrada', em: horas(1), trecho: '[áudio 27s] quem fala?' }, 'Última mensagem: ele, há 1 h: “(áudio 27s) quem fala?”'],
    ['a recepção', { direcao: 'entrada', em: horas(2), trecho: '*[Patricia Adriano]* CLaro, pode enviar sim.', papel: 'recepcao' },
      'Última mensagem: a recepção, há 2 h: “*[Patricia Adriano]* CLaro, pode enviar sim.”'],
    ['o robô', { direcao: 'entrada', em: horas(2), trecho: '[Atendimento] Olá', papel: 'robo' }, 'Última mensagem: a resposta automática, há 2 h: “[Atendimento] Olá”'],
    ['o vídeo nosso', { direcao: 'saida', em: horas(2), trecho: '[vídeo]' }, 'Última mensagem: você, há 2 h: “[vídeo]”'],
  ]
  for (const [nome, ultima, esperado] of CASOS) {
    it(nome, () => assert.equal(linhaDaConversa({ etapa: 'contato', conversa: conversa({ ultima }) }, AGORA), esperado))
  }
})

describe('a licença põe o material no passo, como o interesse', () => {
  it('2ª mensagem anotável à mão', () => {
    const l = lead({ resposta: { tipo: 'licenca', trecho: 'pode enviar sim', em: horas(24) } })
    assert.deepEqual(anotacoesAMao(l, false), ['segunda_enviada'])
  })
})

describe('o dossiê do copiloto (e do Assistente) diz que o áudio não foi ouvido', () => {
  const doCopiloto = (extra: Partial<LeadDoCopiloto> = {}): LeadDoCopiloto => ({
    id: 'B', produto: 'iris', empresa: 'Baobá', nicho: 'psicologia', cidade: 'Vitória', subEtapa: 'Em conversa', etapa: 'contato',
    sinal: 'respondeu-prumo', marcos: {}, links: {}, followupHoje: false, eventos: [],
    resposta: { tipo: 'licenca', trecho: '[áudio 27s]', em: horas(24) }, ...extra,
  })
  it('conversa, resposta e papel', () => {
    const d = montarDossie(doCopiloto(), { conversa: [
      { em: horas(48), direcao: 'entrada', texto: '[áudio 27s]' },
      { em: horas(25), direcao: 'saida', texto: 'Posso de toda forma mandar o vídeo? Sem compromisso nenhum' },
      { em: horas(24), direcao: 'entrada', texto: '*[Patricia Adriano]* CLaro, pode enviar sim.', papel: 'recepcao' },
      { em: horas(23), direcao: 'saida', texto: '[vídeo]' },
    ] })
    assert.equal(d.conversa?.[0].texto, '[áudio de 27s que o sistema não ouviu: o conteúdo é DESCONHECIDO, não suponha que seja interesse]')
    assert.equal(d.conversa?.[0].papel, undefined)
    assert.equal(d.conversa?.[2].papel, 'recepcao')
    assert.equal(d.conversa?.[3].texto, '[vídeo]')
    assert.equal(d.resposta?.tipo, 'licenca')
    assert.match(d.resposta?.trecho ?? '', /DESCONHECIDO/)
  })
})
