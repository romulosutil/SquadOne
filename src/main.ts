import { createApp } from 'vue'
import './index.css'
import RootApp from './RootApp.vue'
import { iniciarTema } from './casca/temaVivo'

// O <script> do index.html já pôs o tema; aqui a fonte da verdade (tema.ts) confirma antes de montar.
iniciarTema()
createApp(RootApp).mount('#app')
