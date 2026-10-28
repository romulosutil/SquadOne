<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import type {CrmLead} from './types'
const props=defineProps<{lead:CrmLead}>(),emit=defineEmits<{registrado:[]}>()
const proposta=computed(()=>props.lead.encontradoContratacao),confirmei=ref(false),ocupado=ref(false),erro=ref('')
const rotulos={preparada:'Proposta preparada','criacao-incerta':'Conferindo a emissão','aguardando-assinatura':'Documento preparado para assinatura',assinada:'Aceite confirmado pela Autentique',recusada:'Documento recusado',expirada:'Proposta expirada',conferencia:'Decisão sobre o documento'}
const url=computed(()=>'/api/operations/crm/encontrado/proposta/'+proposta.value?.referencia)
async function confirmar(){
 if(!proposta.value?.originalHash||!confirmei.value)return
 ocupado.value=true;erro.value=''
 try{const r=await fetch(url.value+'/recuperacao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmar:true,originalHash:proposta.value.originalHash}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error();confirmei.value=false;emit('registrado')}catch{erro.value='Não foi possível confirmar a versão atual. Reabra o documento antes de repetir.'}finally{ocupado.value=false}
}
watch(()=>props.lead.id,()=>{confirmei.value=false;erro.value=''})
</script>
<template>
 <section v-if="proposta" class="crm-ficha__secao" aria-label="Proposta e assinatura do Encontrado">
  <h3>{{ rotulos[proposta.estado] }}</h3><p>{{ proposta.motivo }}</p>
  <p v-if="proposta.aceiteEm">Assinatura observada em {{ new Date(proposta.aceiteEm).toLocaleString('pt-BR') }}.</p>
  <p><a :href="url+'/termo'" target="_blank" rel="noopener">Conferir a proposta desta versão</a><template v-if="proposta.originalHash"> · <a :href="url+'/original'" target="_blank" rel="noopener">Abrir o original da Autentique</a></template></p>
  <template v-if="proposta.recuperacaoPendente&&proposta.originalHash">
   <p>A emissão foi recuperada após uma resposta incerta da integração. Confira o original e os dados antes de liberar o convite.</p>
   <label><input v-model="confirmei" type="checkbox" :disabled="ocupado">Conferi que o original recuperado corresponde a esta proposta e aos dados corretos.</label>
   <button class="botao" :disabled="!confirmei||ocupado" @click="confirmar">Confirmar documento recuperado</button>
  </template>
  <p v-if="erro" role="alert">{{ erro }}</p>
 </section>
</template>
