<script setup>
defineProps({
  quests: {
    type: Array,
    default: () => []
  }
})
</script>

<template>
  <aside class="w-80 border-r-4 border-black bg-[#ff9b71] overflow-y-auto flex flex-col z-10 shadow-[6px_0px_0px_0px_rgba(0,0,0,1)] relative">
    <div class="p-4 border-b-4 border-black bg-[#f4f0e6] sticky top-0 z-20">
      <h2 class="font-black text-xl uppercase">🎒 Mochila de Quests</h2>
    </div>
    
    <div class="p-4 flex flex-col gap-4">
      <div v-if="quests.length === 0" class="text-center font-bold p-6 border-4 border-black border-dashed bg-[#f4f0e6] opacity-90 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        Nenhuma quest ativa. <br/> Use a Command Bar!
      </div>
      
      <div 
        v-for="(quest, index) in quests" 
        :key="index"
        class="border-4 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[4px] hover:translate-y-[4px] transition-all"
      >
        <h3 class="font-bold text-lg leading-tight mb-2">{{ quest.titulo }}</h3>
        <div class="text-sm font-bold flex flex-col gap-1">
          <div class="flex items-center gap-1">
            <span class="bg-black text-white px-2 py-0.5 text-xs uppercase">{{ quest.po_id }}</span>
          </div>
          <div class="text-gray-800">
            ⏰ {{ quest.tipo === 'time_blocking' ? 'Foco: ' + Math.round((new Date(quest.fim) - new Date(quest.inicio)) / 60000) + 'm' : 'Deadline' }}
          </div>
          <div class="text-gray-800 text-xs truncate">
            📅 {{ new Date(quest.tipo === 'time_blocking' ? quest.inicio : quest.fim).toLocaleString() }}
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
