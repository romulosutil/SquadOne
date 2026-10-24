interface StoragePedido {getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void}
interface Tentativa {assinatura:string;requestId:string}
const CHAVE='squadone-delegacao-pendente';
/** Identidade do transporte: falha não encerra intenção; conclusão observada sim. Sem efeito comercial. */
export class IdentidadeDoPedido {
  private atual:Tentativa|null=null;
  constructor(private storage?:StoragePedido,private readonly uuid:()=>string=()=>crypto.randomUUID()){
    try{
      this.storage??=globalThis.sessionStorage;
      const d=JSON.parse(this.storage?.getItem(CHAVE)??'null');
      if(d&&typeof d.assinatura==='string'&&typeof d.requestId==='string'&&/^ui:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(d.requestId))this.atual=d;
    }catch{/* Storage indisponível: conserva intenção em memória. */}
  }
  preparar(intencao:{demanda:string;modo:string;squadId:string|null}):string{
    const assinatura=JSON.stringify(intencao);
    if(this.atual?.assinatura!==assinatura)this.atual={assinatura,requestId:'ui:'+this.uuid()};
    try{this.storage?.setItem(CHAVE,JSON.stringify(this.atual))}catch{/* Sem storage. */}
    return this.atual.requestId;
  }
  concluir(requestId:string):void{
    if(this.atual?.requestId!==requestId)return;
    this.atual=null;try{this.storage?.removeItem(CHAVE)}catch{/* Sem storage. */}
  }
}
