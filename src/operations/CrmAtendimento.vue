<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { textoResponsavelConversa, type ProjecaoResponsavel } from './responsavel-conversa'
const props=defineProps<{lead:CrmLead;disponivel:boolean}>()
const emit=defineEmits<{registrado:[]}>()
const projecao=ref<ProjecaoResponsavel|null>(null), bloqueio=ref<string|null>(null)
const erro=ref(''), recado=ref(''), ocupado=ref(false), incerto=ref(false)
let relogio:ReturnType<typeof setInterval>|undefined
const tentativaId=ref('')
const cobertura=ref<{modo:string;estado:string;entradas:number;semProva:number;conflitos:number;semId:number;semOportunidade:number;falhasLeitura:number}|null>(null)
const erroCobertura=ref('')
async function atualizarCobertura() {
  try {
    const r=await fetch('/api/operations/crm/atendimento/cobertura',{cache:'no-store',signal:AbortSignal.timeout(8000)})
    if(!r.ok) throw new Error('Cobertura temporariamente indisponível.')
    const v=await r.json();if(!v.cobertura)throw new Error('Cobertura ainda não conferida.')
    cobertura.value=v.cobertura;erroCobertura.value=''
  } catch {cobertura.value=null;erroCobertura.value='Não foi possível conferir a cobertura das capturas. Isso não confirma ausência de respostas.'}
}
async function atualizar() {
  const id=props.lead.id
  try {
    const r=await fetch('/api/operations/crm/atendimento/responsavel?leadId='+encodeURIComponent(id))
    const v=await r.json()
    if (!r.ok) throw new Error(v.error ?? 'Responsabilidade indisponível.')
    if (props.lead.id!==id) return
    projecao.value=v.projecao;bloqueio.value=v.bloqueio
    if (incerto.value && projecao.value?.registro?.id===tentativaId.value && projecao.value?.estado==='definido' && !bloqueio.value?.includes('aguardando')) incerto.value=false
  } catch(e) { if(props.lead.id===id) {projecao.value=null;erro.value=e instanceof Error?e.message:'Falha na leitura.'} }
}
async function assumir(responsavel:'romulo'|'time') {
  const atual=projecao.value
  if(!atual?.identidade||atual.estado==='bloqueado'||ocupado.value||incerto.value) return
  const lead=props.lead
  ocupado.value=true;incerto.value=true;erro.value='';recado.value=''
  const nota={v:2 as const,id:crypto.randomUUID(),...atual.identidade,responsavel,data:new Date().toISOString(),motivo:responsavel==='romulo'?'Assumir negociação e atendimento.':'Devolver ao time dentro das permissões ativas, preservando restrições.',humano:true as const,anterior:atual.registro?.id??null}
  tentativaId.value=nota.id
  try {
    const r=await fetch('/api/operations/crm/registro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({produto:lead.produto,id:lead.chave,tipo:'nota',texto:textoResponsavelConversa(nota),data:''})})
    const v=await r.json()
    if(props.lead.id!==lead.id) return
    if(!r.ok) {incerto.value=v.naoEnviado!==true;throw new Error(v.error??'Resultado não confirmado.')}
    incerto.value=true;recado.value='Recebido. Aguarde a confirmação na fonte antes de outra troca.';emit('registrado');await atualizar()
  } catch(e) {if(props.lead.id===lead.id) erro.value=e instanceof Error?e.message:'Resultado desconhecido. Confira a fonte antes de repetir.'}
  finally {if(props.lead.id===lead.id) ocupado.value=false}
}
onMounted(()=>{void atualizar();void atualizarCobertura();relogio=setInterval(()=>{void atualizar();void atualizarCobertura()},15000)})
onBeforeUnmount(()=>clearInterval(relogio))
watch(()=>props.lead.id,()=>{projecao.value=null;recado.value='';erro.value='';incerto.value=false;ocupado.value=false;tentativaId.value='';void atualizar()})
</script>
<template>
  <section class="crm-ficha__secao" aria-label="Responsável pelo atendimento">
    <h3>Responsável pelo atendimento</h3>
    <p>{{ projecao?.motivo ?? 'Conferindo a fonte…' }}</p>
    <p v-if="bloqueio" class="recado">{{ bloqueio }}</p>
    <p class="texto-2 texto-pequeno">{{ lead.produto==='site'?'O time conduz os pedidos padrão do Encontrado dentro das permissões ativas. Condições especiais e decisões que exigem você continuam aqui.':'O time analisa e prepara rascunhos. Negociação, proposta final, contrato e pagamento ficam com você.' }}</p>
    <div class="crm-ficha__acoes">
      <button type="button" class="botao botao--primario" :disabled="!disponivel||!projecao?.identidade||projecao.estado==='bloqueado'||bloqueio?.includes('aguardando')||bloqueio?.startsWith('Responsabilidade anterior')||ocupado||incerto||projecao.registro?.responsavel==='romulo'" @click="assumir('romulo')">Assumir conversa</button>
      <button type="button" class="botao botao--leve" :disabled="!disponivel||!projecao?.identidade||projecao.estado==='bloqueado'||bloqueio?.includes('aguardando')||bloqueio?.startsWith('Responsabilidade anterior')||ocupado||incerto||projecao.registro?.responsavel==='time'" @click="assumir('time')">Devolver ao time</button>
    </div>
    <p v-if="recado" role="status">{{ recado }}</p><p v-if="erro" role="alert">{{ erro }}</p>
    <div v-if="lead.atendimentoComercial" class="recado">
      <strong>{{ lead.atendimentoComercial.titulo }}</strong><p>{{ lead.atendimentoComercial.motivo }}</p>
      <p v-if="lead.atendimentoComercial.texto">{{ lead.atendimentoComercial.alvo==='cliente'?'Rascunho para conferir: ':'' }}{{ lead.atendimentoComercial.texto }}</p>
    </div>
    <div v-if="cobertura?.modo==='identidade'" class="recado" aria-label="Conferência das capturas">
      <strong>Conferência das capturas</strong>
      <p>{{ cobertura.entradas }} registros de resposta conferidos no histórico. {{ cobertura.semProva + cobertura.conflitos }} ocorrências pedem revisão de identidade.</p>
      <p v-if="cobertura.semId || cobertura.semOportunidade">{{ cobertura.semId }} registros sem ID original · {{ cobertura.semOportunidade }} sem oportunidade associada. Permanecem na conferência interna.</p>
      <p v-if="cobertura.falhasLeitura || cobertura.estado==='indisponivel'">Há fontes indisponíveis. Confira o WhatsApp antes de concluir que o atendimento está em dia.</p>
      <p class="texto-2 texto-pequeno">Identidade não comprovada gera revisão interna. Não libera contato com o cliente.</p>
    </div>
    <p v-if="erroCobertura" role="status">{{ erroCobertura }}</p>
  </section>
</template>
