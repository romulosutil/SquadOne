import type {Express,Request} from 'express'
import {ConfiguracaoPropostaEncontrado,HASH_POLITICA_PROPOSTA_ENCONTRADO} from './encontrado-proposta-config.ts'
import type {ContratacaoEncontrado} from './encontrado-contratacao.ts'
import {validarParteEncontrado,validarCondicoesEncontrado,htmlPropostaEncontrado} from '../src/operations/encontrado-proposta.ts'
export const ROTA_CONFIG_PROPOSTA='/api/operations/crm/encontrado/proposta'
/** Além das guardas globais de identidade/origem, estas rotas exigem operador reconhecido. */
export function montarRotasPropostaEncontrado(app:Pick<Express,'get'|'post'>,deps:{config:ConfiguracaoPropostaEncontrado;contratacao:ContratacaoEncontrado;operador:(req:Request)=>string|null;ativar:(modeloHash:string,politicaHash:string)=>Promise<void>}){
  const acesso=(req:Request)=>deps.operador(req)
  app.get(ROTA_CONFIG_PROPOSTA+'/configuracao',async(req,res)=>{
    res.set('Cache-Control','no-store');if(!acesso(req)){res.status(403).json({error:'Somente o operador da Central pode abrir este cadastro.'});return}
    try{res.json(await deps.config.visao())}catch{res.status(503).json({error:'Não foi possível conferir o cadastro e o modelo.'})}
  })
  app.post(ROTA_CONFIG_PROPOSTA+'/previa',async(req,res)=>{
    res.set('Cache-Control','no-store');if(!acesso(req)){res.status(403).json({error:'Operador não autorizado.'});return}
    try{const p=validarParteEncontrado(req.body.prumo),c=validarCondicoesEncontrado(req.body.condicoes);res.json(deps.config.previa(p,c))}catch{res.status(400).json({error:'Confira todos os dados da empresa e as condições antes de revisar.'})}
  })
  app.post(ROTA_CONFIG_PROPOSTA+'/configuracao',async(req,res)=>{
    res.set('Cache-Control','no-store');if(!acesso(req)){res.status(403).json({error:'Operador não autorizado.'});return}
    try{await deps.config.salvar(req.body);res.json(await deps.config.visao())}catch{res.status(409).json({error:'Cadastro não confirmado. Confira os campos, o token e a conta da Autentique; o envio permanece condicionado à aprovação do modelo.'})}
  })
  app.post(ROTA_CONFIG_PROPOSTA+'/aprovar',async(req,res)=>{
    res.set('Cache-Control','no-store');const operador=acesso(req);if(!operador){res.status(403).json({error:'Operador não autorizado.'});return}
    const v=req.body
    if(!v||Object.keys(v).sort().join(',')!=='autorizarDadosAutentique,confirmar,modeloHash'||v.confirmar!==true||v.autorizarDadosAutentique!==true||typeof v.modeloHash!=='string'||!/^[a-f0-9]{64}$/.test(v.modeloHash)){res.status(400).json({error:'A aprovação exige a versão atual e a autorização de uso dos dados na Autentique.'});return}
    try{await deps.config.aprovar(v.modeloHash,operador);await deps.ativar(v.modeloHash,HASH_POLITICA_PROPOSTA_ENCONTRADO);res.json({ok:true,...await deps.config.visao()})}catch{res.status(409).json({error:'Ativação não confirmada. Reabra o modelo, confira a conta e preserve qualquer pausa do atendimento.'})}
  })
  app.get(ROTA_CONFIG_PROPOSTA+'/:id/termo',async(req,res)=>{
    res.set('Cache-Control','no-store');if(!acesso(req)){res.sendStatus(403);return}
    try{const p=(await deps.contratacao.listar()).find(p=>p.id===req.params.id);if(!p){res.sendStatus(404);return}res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");res.type('html').send(htmlPropostaEncontrado(p))}catch{res.sendStatus(409)}
  })
  app.get(ROTA_CONFIG_PROPOSTA+'/:id/original',async(req,res)=>{
    res.set('Cache-Control','no-store');if(!acesso(req)){res.sendStatus(403);return}
    try{const r=await deps.contratacao.originalParaConferencia(String(req.params.id));res.set('X-Original-Hash',r.hash);res.set('Content-Disposition','inline; filename="proposta-encontrado.pdf"');res.type('pdf').send(r.bytes)}catch{res.sendStatus(409)}
  })
  app.post(ROTA_CONFIG_PROPOSTA+'/:id/recuperacao',async(req,res)=>{
    res.set('Cache-Control','no-store');if(!acesso(req)){res.sendStatus(403);return}
    const v=req.body
    if(!v||Object.keys(v).sort().join(',')!=='confirmar,originalHash'||v.confirmar!==true||typeof v.originalHash!=='string'||!/^[a-f0-9]{64}$/.test(v.originalHash)){res.status(400).json({error:'Confira o documento original desta versão antes de confirmar.'});return}
    try{await deps.contratacao.confirmarRecuperacao(String(req.params.id),v.originalHash);res.json({ok:true})}catch{res.status(409).json({error:'O original ou a assinatura mudou. Reabra a conferência atual.'})}
  })
}
