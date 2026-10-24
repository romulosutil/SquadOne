import {ErroCalendario} from './calendar.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EstadoOperacionalDuravel,comPrazoOperacional} from './estado-operacional-duravel.ts';
import {hashCanonicoComercial} from './registro-comercial-duravel.ts';
import type {Intervalo} from './alocador.ts';

type Json = null|boolean|number|string|Json[]|{[k:string]:Json};
interface EventoReservado {id:string;hash:string;corpo:Record<string,Json>;estado:'tentando'|'confirmado'|'rejeitado'|'cancelado';intervalo?:Intervalo;ocupacaoConferida?:boolean;resposta?:{id:string;htmlLink?:string}}
interface OperacaoAgenda {id:string;hash:string;estado:'processando'|'concluido'|'ambiguo'|'sem-envio'|'reconciliado';eventos:EventoReservado[];resultado?:Json;em:string}
interface EstadoAgenda {v:1;operacoes:OperacaoAgenda[]}
export class AgendaRequerConferencia extends Error {
  constructor(){super('Há uma reserva da agenda sem conclusão comprovada. Confira o journal e o Calendar antes de repetir; nenhum reenvio automático foi autorizado.');this.name='AgendaRequerConferencia'}
}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const objeto=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function validar(v:unknown):EstadoAgenda {
  if(!objeto(v)||v.v!==1||!Array.isArray(v.operacoes))throw new Error('Journal agenda inválido.');
  const ids=new Set<string>();
  for(const o of v.operacoes){
    if(!objeto(o)||typeof o.id!=='string'||!/^[a-f0-9]{64}$/.test(o.id)||ids.has(o.id)||typeof o.hash!=='string'||!/^[a-f0-9]{64}$/.test(o.hash)||!['processando','concluido','ambiguo','sem-envio','reconciliado'].includes(String(o.estado))||!Array.isArray(o.eventos)||typeof o.em!=='string'||!Number.isFinite(Date.parse(o.em)))throw new Error('Operação agenda inválida.');
    ids.add(o.id);
    if(o.estado==='concluido'&&!Object.hasOwn(o,'resultado'))throw new Error('Resultado agenda ausente.');
    for(const e of o.eventos)if(!objeto(e)||typeof e.id!=='string'||!/^so[a-f0-9]{64}$/.test(e.id)||typeof e.hash!=='string'||!objeto(e.corpo)||hashCanonicoComercial(e.corpo)!==e.hash||!['tentando','confirmado','rejeitado','cancelado'].includes(String(e.estado))||e.intervalo!==undefined&&(!objeto(e.intervalo)||typeof e.intervalo.inicio!=='number'||typeof e.intervalo.fim!=='number'||!Number.isFinite(e.intervalo.inicio)||!Number.isFinite(e.intervalo.fim)||e.intervalo.fim<=e.intervalo.inicio))throw new Error('Evento agenda inválido.');
  }
  return v as unknown as EstadoAgenda;
}
const intervalo=(corpo:Record<string,Json>):Intervalo|undefined=>{
  if(corpo.transparency==='transparent')return undefined;
  const a=corpo.start as {dateTime?:string}|undefined,b=corpo.end as {dateTime?:string}|undefined;
  const inicio=Date.parse(a?.dateTime??''),fim=Date.parse(b?.dateTime??'');
  return Number.isFinite(inicio)&&Number.isFinite(fim)&&fim>inicio?{inicio,fim}:undefined;
};
export interface SessaoReservaAgenda {ocupacao:Intervalo[];gravar(corpo:Record<string,unknown>):Promise<{id:string;htmlLink?:string}>}
/** Derivado operacional: persiste ANTES do POST, nunca autoriza retry de resultado ambíguo. */
export class GarantiasAgenda {
  constructor(readonly pasta:string,private readonly fetcher:typeof fetch=fetch,private readonly prazoMs=20000){}
  private arquivo(calendario:string){return new EstadoOperacionalDuravel<EstadoAgenda>(path.join(this.pasta,sha(calendario)+'.json'),()=>({v:1,operacoes:[]}),validar)}
  async executar<T>(calendario:string,chave:string,conteudo:unknown,token:string,fn:(s:SessaoReservaAgenda)=>Promise<T>):Promise<T>{
    if(!calendario||!chave||chave.length>500||!token)throw new Error('Identidade da reserva inválida.');
    const id=sha(chave),hash=hashCanonicoComercial(conteudo),url='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendario)+'/events';
    return this.arquivo(calendario).usar(async(estado,salvar)=>{
      let op=estado.operacoes.find(o=>o.id===id);
      if(op&&op.hash!==hash)throw new Error('requestId reutilizado com outra intenção; a reserva foi recusada.');
      if(op?.estado==='concluido')return structuredClone(op.resultado) as T;
      if(op?.estado==='processando'&&op.eventos.length>0||op?.estado==='ambiguo'||op?.estado==='reconciliado')throw new AgendaRequerConferencia();
      if(estado.operacoes.some(o=>o.id!==id&&(o.estado==='ambiguo'||o.eventos.some(e=>e.estado==='tentando'))))throw new AgendaRequerConferencia();
      if(!op){op={id,hash,estado:'processando',eventos:[],em:new Date().toISOString()};estado.operacoes.push(op)}
      else {op.estado='processando';op.eventos=[]}
      await salvar();
      const operacao=op;
      const sessao:SessaoReservaAgenda={
        ocupacao:estado.operacoes.flatMap(o=>o.eventos.flatMap(e=>e.estado==='confirmado'&&(e.ocupacaoConferida??e.corpo.transparency!=='transparent')&&e.intervalo?[{...e.intervalo}]:[])),
        gravar:async corpo=>{
          // ID é estável para esta demanda e subevento; nunca depende do horário escolhido.
          const eventId='so'+sha(id+':'+operacao.eventos.length),corpoHash=hashCanonicoComercial(corpo);
          const e:EventoReservado={id:eventId,hash:corpoHash,corpo:structuredClone(corpo) as Record<string,Json>,estado:'tentando',...(intervalo(corpo as Record<string,Json>)?{intervalo:intervalo(corpo as Record<string,Json>)}:{})};
          operacao.eventos.push(e);await salvar();
          try{
            const recebido=await comPrazoOperacional(async signal=>{
              const r=await this.fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal,body:JSON.stringify({...corpo,id:eventId})});
              const dados:unknown=await r.json().catch(()=>null);
              const reason=objeto(dados)&&objeto(dados.error)&&Array.isArray(dados.error.errors)&&objeto(dados.error.errors[0])?dados.error.errors[0].reason:null;
              const motivo=typeof reason==='string'&&['authError','insufficientPermissions','forbidden','accessNotConfigured'].includes(reason)?reason:'';
              return {status:r.status,ok:r.ok,dados:r.ok?dados:null,motivo};
            },this.prazoMs);
            // Nenhuma continuação tardia do fetch pode alterar o estado ou gravar fora da trava.
            if(!recebido.ok){
              if([400,401,403,404,422].includes(recebido.status)){e.estado='rejeitado';await salvar();throw new ErroCalendario(recebido.status,JSON.stringify({error:{message:'O Calendar recusou esta reserva.',errors:[{reason:recebido.motivo}]}}))}
              throw new AgendaRequerConferencia();
            }
            const d:unknown=recebido.dados;
            if(!objeto(d)||d.id!==eventId)throw new AgendaRequerConferencia();
            const resposta={id:eventId,...(typeof d.htmlLink==='string'?{htmlLink:d.htmlLink}:{})};
            e.estado='confirmado';e.resposta=resposta;await salvar();return resposta;
          }catch(erro){
            if(e.estado==='tentando'){operacao.estado='ambiguo';await salvar();throw new AgendaRequerConferencia()}
            throw erro;
          }
        },
      };
      try{
        const resultado=await fn(sessao);
        if(operacao.eventos.some(e=>e.estado==='tentando'))throw new AgendaRequerConferencia();
        operacao.estado='concluido';operacao.resultado=JSON.parse(JSON.stringify(resultado)) as Json;await salvar();return resultado;
      }catch(e){
        if(operacao.estado!=='ambiguo')operacao.estado=operacao.eventos.some(ev=>ev.estado==='confirmado'||ev.estado==='tentando')?'ambiguo':'sem-envio';
        await salvar();throw e;
      }
    });
  }
  /** Conferência EXPLÍCITA e só GET. 404/timeout/divergência mantém bloqueio; nunca repete POST. */
  async reconciliar(calendario:string,token:string):Promise<{confirmados:number;pendentes:number}> {
    const url='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendario)+'/events/';
    return this.arquivo(calendario).usar(async(estado,salvar)=>{
      let confirmados=0,pendentes=0;
      for(const o of estado.operacoes)for(const e of o.eventos){
        if(!['tentando','confirmado'].includes(e.estado))continue;
        try{
          const d:unknown=await comPrazoOperacional(async signal=>{const r=await this.fetcher(url+encodeURIComponent(e.id),{headers:{Authorization:'Bearer '+token},signal});if(!r.ok)throw new Error();return r.json()},this.prazoMs);
          if(!objeto(d)||d.id!==e.id)throw new Error();
          if(d.status==='cancelled'){e.estado='cancelado';o.estado='reconciliado';continue}
          const projetar=(esperado:unknown,atual:unknown):unknown=>objeto(esperado)&&objeto(atual)?Object.fromEntries(Object.entries(esperado).map(([k,v])=>[k,projetar(v,atual[k])])):atual;
          if(hashCanonicoComercial(projetar(e.corpo,d))!==e.hash){
            const privado=(e.corpo.extendedProperties as {private?:unknown}|undefined)?.private;
            const atualPrivado=(d.extendedProperties as {private?:unknown}|undefined)?.private;
            if(!privado||hashCanonicoComercial(projetar(privado,atualPrivado))!==hashCanonicoComercial(privado))throw new Error();
            if(!objeto(d.start)||!objeto(d.end))throw new Error();
            o.estado='reconciliado';
          }
          e.intervalo=intervalo(d as Record<string,Json>);e.ocupacaoConferida=d.transparency!=='transparent';
          e.estado='confirmado';confirmados++;
        }catch{e.estado='tentando';o.estado='ambiguo';pendentes++}
      }
      for(const o of estado.operacoes){
        if(o.eventos.some(e=>e.estado==='tentando')){o.estado='ambiguo';continue}
        if((o.estado==='ambiguo'||o.estado==='processando')&&o.eventos.length&&o.eventos.every(e=>['confirmado','cancelado','rejeitado'].includes(e.estado)))o.estado='reconciliado';
      }
      await salvar();return {confirmados,pendentes};
    });
  }
  /** Só metadados: suficiente para conferir bloqueio sem expor títulos, texto ou credenciais. */
  async status(calendario:string){return this.arquivo(calendario).usar(async e=>({operacoes:e.operacoes.map(o=>({id:o.id,estado:o.estado,eventos:o.eventos.map(ev=>({id:ev.id,estado:ev.estado}))}))}))}
}


/** Journal da intenção completa antes do modelo; repetir não executa outro turno. */
export class DemandasAgendaDuraveis {
  constructor(readonly pasta:string){}
  async status():Promise<{pedidos:Array<{id:string;estado:string}>}>{
    let nomes:string[];try{nomes=await fs.readdir(this.pasta)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {pedidos:[]};throw e}
    const pedidos:Array<{id:string;estado:string}>=[];
    for(const nome of nomes.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,1000)){
      const d=JSON.parse(await fs.readFile(path.join(this.pasta,nome),'utf8')) as {v?:number;pedido?:{estado?:string}};
      if(d.v!==1||!d.pedido||!['processando','concluido','ambiguo'].includes(d.pedido.estado??''))throw new Error('Journal da demanda ilegível.');
      pedidos.push({id:nome.slice(0,-5),estado:d.pedido.estado!});
    }
    return {pedidos};
  }
  async executar<T>(requestId:string,intencao:unknown,fn:()=>Promise<T>):Promise<T>{
    if(!requestId||requestId.length>300)throw new Error('Identidade da demanda inválida.');
    const hash=hashCanonicoComercial(intencao);
    type Estado={v:1;pedido?:{hash:string;estado:'processando'|'concluido'|'ambiguo';resultado?:Json}};
    const validar=(v:unknown):Estado=>{
      const e=v as Estado;
      if(!e||e.v!==1||e.pedido&&(!/^[a-f0-9]{64}$/.test(e.pedido.hash)||!['processando','concluido','ambiguo'].includes(e.pedido.estado)||e.pedido.estado==='concluido'&&!Object.hasOwn(e.pedido,'resultado')))throw new Error('Journal da demanda inválido.');
      return e;
    };
    const arquivo=new EstadoOperacionalDuravel<Estado>(path.join(this.pasta,sha(requestId)+'.json'),()=>({v:1}),validar);
    return arquivo.usar(async(e,salvar)=>{
      if(e.pedido){
        if(e.pedido.hash!==hash)throw new Error('requestId reutilizado com outra intenção; nenhuma operação foi executada.');
        if(e.pedido.estado==='concluido')return structuredClone(e.pedido.resultado) as T;
        if(e.pedido.estado==='processando'){e.pedido.estado='ambiguo';await salvar()}
        throw new AgendaRequerConferencia();
      }
      e.pedido={hash,estado:'processando'};await salvar();
      try{const resultado=await fn();e.pedido.estado='concluido';e.pedido.resultado=JSON.parse(JSON.stringify(resultado)) as Json;await salvar();return resultado}
      catch(erro){e.pedido.estado='ambiguo';await salvar();throw erro}
    });
  }
}
