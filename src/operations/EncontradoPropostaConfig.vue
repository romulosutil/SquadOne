<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,reactive,ref} from 'vue'
import {CONDICOES_SUGERIDAS_ENCONTRADO,type ParteEncontrado,type CondicoesEncontrado} from './encontrado-proposta'
interface Visao {prumo:ParteEncontrado;condicoes:CondicoesEncontrado;html:string;modeloHash:string;credencialConfigurada:boolean;homologacao:string;conta:{nome:string;email:string;gratuita:boolean}|null;aprovado:boolean;pendencias:string[]}
const base='/api/operations/crm/encontrado/proposta',visao=ref<Visao|null>(null),erro=ref(''),recado=ref(''),ocupado=ref(false),aprovo=ref(false),token=ref('')
const prumo=reactive<ParteEncontrado>({razaoSocial:'',cnpj:'',representante:'Rômulo Sutil Corrêa',email:'contato@prumo.services'})
const condicoes=reactive<CondicoesEncontrado>({...CONDICOES_SUGERIDAS_ENCONTRADO})
const mudou=computed(()=>!visao.value||JSON.stringify(prumo)!==JSON.stringify(visao.value.prumo)||JSON.stringify(condicoes)!==JSON.stringify(visao.value.condicoes)||!!token.value)
function receber(v:Visao){visao.value=v;Object.assign(prumo,v.prumo);Object.assign(condicoes,v.condicoes);aprovo.value=false}
async function carregar(){try{const r=await fetch(base+'/configuracao',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error();receber(await r.json())}catch{erro.value='Não foi possível conferir o cadastro privado da proposta.'}}
async function salvar(){
 ocupado.value=true;erro.value='';recado.value=''
 try{const r=await fetch(base+'/configuracao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prumo:{...prumo},condicoes:{...condicoes},...(token.value?{token:token.value}:{})}),signal:AbortSignal.timeout(30000)});const v=await r.json();if(!r.ok)throw new Error(v.error);receber(v);recado.value='Cadastro salvo. Confira o modelo abaixo antes de ativar.'}catch(e){erro.value=e instanceof Error?e.message:'Cadastro não confirmado.'}finally{token.value='';ocupado.value=false}
}
async function ativar(){
 if(!visao.value||!aprovo.value||mudou.value)return
 ocupado.value=true;erro.value='';recado.value=''
 try{const r=await fetch(base+'/aprovar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modeloHash:visao.value.modeloHash,confirmar:true,autorizarDadosAutentique:true}),signal:AbortSignal.timeout(30000)});const v=await r.json();if(!r.ok)throw new Error(v.error);receber(v);recado.value='Padrão aprovado e propostas ativadas para novos pedidos. Condições especiais continuam com você.'}catch(e){erro.value=e instanceof Error?e.message:'Ativação não confirmada. Reabra a configuração antes de repetir.'}finally{ocupado.value=false}
}
let relogio:ReturnType<typeof setInterval>|undefined
onMounted(()=>{void carregar();relogio=setInterval(()=>{if(visao.value?.credencialConfigurada&&visao.value.homologacao==='pendente'&&!mudou.value&&!ocupado.value)void carregar()},10000)})
onBeforeUnmount(()=>clearInterval(relogio))
</script>
<template>
 <section id="encontrado-proposta" class="mais__bloco encontrado-config" aria-labelledby="proposta-config-titulo">
  <header class="cabecalho-bloco"><div><span class="sobretitulo">Encontrado</span><h2 id="proposta-config-titulo">Proposta padrão e assinatura</h2></div></header>
  <p>Cadastre a pessoa jurídica da Prumo e confira o padrão uma vez. Nos pedidos seguintes, o time coleta os dados do cliente, prepara o documento e acompanha a assinatura.</p>
  <p v-if="visao?.aprovado" role="status">Modelo aprovado. A cobrança continua dependendo do cliente ver o site no ar.</p>
  <ul v-if="visao?.pendencias.length"><li v-for="p in visao.pendencias" :key="p">{{ p }}</li></ul>
  <form @submit.prevent="salvar">
   <h3>Quem presta o serviço</h3>
   <div class="encontrado-config__grade">
    <label>Razão social<input v-model="prumo.razaoSocial" required maxlength="160" autocomplete="organization"></label>
    <label>CNPJ<input v-model="prumo.cnpj" required maxlength="18" autocapitalize="characters" autocomplete="off"></label>
    <label>Representante da Prumo<input v-model="prumo.representante" required maxlength="120" autocomplete="name"></label>
    <label>E-mail de contato<input v-model="prumo.email" required type="email" maxlength="180" autocomplete="email"></label>
   </div>
   <h3>Condições do padrão</h3>
   <p class="texto-2">Os números abaixo são sugestões do modelo existente. Confira antes de aprovar. Implantação: R$ 690 após o cliente ver o site no ar; mensalidade: R$ 39.</p>
   <div class="encontrado-config__grade">
    <label>Prazo após materiais e aprovações — dias úteis<input v-model.number="condicoes.prazoDiasUteis" type="number" required min="1" max="60"></label>
    <label>Validade da proposta — dias<input v-model.number="condicoes.validadeDias" type="number" required min="1" max="60"></label>
    <label>Aviso para encerrar mensalidade — dias<input v-model.number="condicoes.avisoEncerramentoDias" type="number" required min="0" max="60"></label>
    <label>Início da mensalidade<input value="Mês seguinte à entrega aprovada e ao site visto no ar" readonly></label>
   </div>
   <h3>Conexão com a Autentique</h3>
   <p class="texto-2">Use uma conta no plano gratuito. Esta automação limita a emissão a dez documentos por mês; necessidade de plano adicional será uma decisão sua.</p>
   <p><a href="https://www.autentique.com.br/" target="_blank" rel="noopener noreferrer">Criar conta na Autentique</a> · <a href="https://painel.autentique.com.br/" target="_blank" rel="noopener noreferrer">Abrir painel para obter o token de API</a></p>
   <p v-if="visao?.conta">Conta conectada: {{ visao.conta.nome }} · {{ visao.conta.email }}</p>
   <label>Token de API — cadastro privado<input v-model="token" type="password" autocomplete="off" spellcheck="false" maxlength="4096" :placeholder="visao?.credencialConfigurada?'Já configurado; deixe vazio para conservar':'Cole aqui o token criado no painel da Autentique'"></label>
   <p class="texto-2">O token é guardado no servidor e não volta para esta tela. Não envie o token pela conversa.</p>
   <button class="botao" type="submit" :disabled="ocupado">{{ ocupado?'Conferindo…':'Salvar cadastro e conferir conexão' }}</button>
  </form>
  <h3>Conferir o documento</h3>
  <p v-if="mudou" class="texto-2">Salve as alterações para atualizar a prévia antes de aprovar.</p>
  <iframe v-if="visao" :srcdoc="visao.html" sandbox="" title="Minuta do padrão Encontrado para aprovação" class="encontrado-config__previa"></iframe>
  <label class="encontrado-config__aceite"><input v-model="aprovo" type="checkbox" :disabled="ocupado||mudou||!visao?.credencialConfigurada||visao?.homologacao!=='aprovada'">Aprovo este modelo e estas condições para o Encontrado e autorizo o envio automático do documento e dos dados dos signatários à Autentique nos pedidos padrão.</label>
  <button class="botao botao--primario" type="button" :disabled="ocupado||mudou||!aprovo||!visao?.credencialConfigurada||!visao?.conta?.gratuita||visao?.homologacao!=='aprovada'" @click="ativar">Aprovar padrão e ativar propostas</button>
  <p v-if="recado" role="status">{{ recado }}</p><p v-if="erro" role="alert">{{ erro }}</p>
 </section>
</template>
<style scoped>
.encontrado-config label{display:flex;flex-direction:column;gap:var(--esp-2);margin:var(--esp-3) 0}.encontrado-config input:not([type=checkbox]){font:inherit;padding:var(--esp-3);min-width:0;width:100%;color:inherit;background:transparent;border:var(--linha-fina);border-radius:var(--raio-controle)}.encontrado-config__grade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 var(--esp-4)}.encontrado-config__previa{width:100%;height:540px;border:var(--linha-fina);border-radius:var(--raio-controle);background:#fff}.encontrado-config .encontrado-config__aceite{flex-direction:row;align-items:flex-start;gap:var(--esp-2)}.encontrado-config__aceite input{margin-top:var(--esp-1);flex:none}.encontrado-config h3{margin-top:var(--esp-6)}@media(max-width:640px){.encontrado-config__grade{grid-template-columns:1fr}.encontrado-config__previa{height:460px}}
</style>
