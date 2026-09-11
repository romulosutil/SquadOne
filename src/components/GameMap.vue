<script setup>
import { computed } from 'vue'

const props = defineProps({
  agent: {
    type: String,
    default: 'Idle'
  }
})

// Mapeando a posição do agente no Grid (linha, coluna)
const agentPosition = computed(() => {
  switch (props.agent) {
    case 'TechLead':
      return { row: 3, col: 2 } // Estação A
    case 'ProfissionalMaker':
      return { row: 3, col: 8 } // Estação B
    case 'PessoalFamiliar':
      return { row: 8, col: 5 } // Estação C
    default:
      return { row: 5, col: 5 } // Centro (Idle)
  }
})
</script>

<template>
  <!-- Cenário 16-bits -->
  <div class="w-full h-full border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] bg-[#8cb07a] relative overflow-hidden flex flex-col">
    <div class="p-2 border-b-4 border-black bg-[#f4f0e6] z-20 shrink-0 flex justify-between items-center">
      <span class="font-black uppercase text-sm">📍 Mapa do Escritório</span>
      <span class="font-bold text-xs uppercase px-2 py-1 bg-black text-white">Status: {{ agent === 'Idle' ? 'Aguardando Demandas' : 'Agente ' + agent + ' Ativo' }}</span>
    </div>
    
    <!-- 
      CSS Grid 10x10.
    -->
    <div class="flex-1 grid grid-cols-10 grid-rows-10 w-full h-full relative p-4 gap-2">
      <!-- Background pattern (grass/pixel feel) -->
      <div class="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0ibm9uZSIvPgo8cGF0aCBkPSJNMCAwdjIwaDIwVjBIMHptMTAgMTBoMTB2MTBIMTBWMTB6IiBmaWxsPSIjMDAwIiBmaWxsLW9wYWNpdHk9IjEuMCIvPgo8L3N2Zz4=')]"></div>

      <!-- Estação A: TechLead (Computadores) -->
      <div class="col-start-2 row-start-2 col-span-2 row-span-2 border-4 border-black bg-[#4338ca] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center justify-center relative z-10">
        <div class="text-3xl mb-1">💻</div>
        <span class="text-white font-black text-center text-[10px] uppercase leading-tight bg-black px-1">TechLead</span>
      </div>

      <!-- Estação B: ProfissionalMaker (Quadro Branco) -->
      <div class="col-start-8 row-start-2 col-span-2 row-span-2 border-4 border-black bg-[#f59e0b] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center justify-center relative z-10">
        <div class="text-3xl mb-1">📋</div>
        <span class="text-black font-black text-center text-[10px] uppercase leading-tight bg-white border-2 border-black px-1">Maker</span>
      </div>

      <!-- Estação C: PessoalFamiliar (Lounge) -->
      <div class="col-start-5 row-start-8 col-span-2 row-span-2 border-4 border-black bg-[#ec4899] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center justify-center relative z-10">
        <div class="text-3xl mb-1">🛋️</div>
        <span class="text-white font-black text-center text-[10px] uppercase leading-tight bg-black px-1">Família</span>
      </div>

      <!-- Bonequinho do Agente -->
      <div 
        class="agent-character flex flex-col items-center justify-center z-20 pointer-events-none"
        :style="{
          gridColumnStart: agentPosition.col,
          gridRowStart: agentPosition.row
        }"
      >
        <!-- Shadow -->
        <div class="absolute bottom-0 w-8 h-3 bg-black opacity-30 rounded-full blur-[2px] -z-10"></div>
        <!-- Sprite -->
        <div class="w-12 h-12 border-4 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center animate-bounce">
          <span class="text-2xl">{{ agent === 'TechLead' ? '🧑‍💻' : agent === 'ProfissionalMaker' ? '🧑‍🎨' : agent === 'PessoalFamiliar' ? '🧑‍🍼' : '👾' }}</span>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/*
 * Lógica de Transição:
 * Animar grid-column e grid-row permite que o elemento mova-se fluidamente através das células do CSS Grid
 * em navegadores modernos que suportam interpolação dessas propriedades.
 */
.agent-character {
  /* Alinha exatamente na célula designada */
  grid-column-end: span 1;
  grid-row-end: span 1;
  /* Transição suave de movimento */
  transition: grid-column-start 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), 
              grid-row-start 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}
</style>
