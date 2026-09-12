<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits(['delegate'])

const demanda = ref('')
const isTimeBlocking = ref(true)

const onSubmit = () => {
  if (!demanda.value.trim()) return
  
  emit('delegate', {
    demanda: demanda.value,
    tipo_agendamento: isTimeBlocking.value ? 'time_blocking' : 'deadline'
  })
  
  demanda.value = ''
}
</script>

<template>
  <div class="h-24 border-t-4 border-black bg-[#bbf7d0] px-6 py-4 flex items-center justify-between gap-6 shrink-0 z-20 shadow-[0px_-6px_0px_0px_rgba(0,0,0,1)] relative">
    
    <div class="flex-1">
      <input 
        v-model="demanda"
        @keyup.enter="onSubmit"
        type="text" 
        placeholder="Descreva a demanda da Quest..." 
        class="w-full h-14 border-4 border-black px-4 font-bold text-lg shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[4px] focus:translate-y-[4px] transition-all bg-white"
      />
    </div>

    <!-- Toggle Neo-Brutalista -->
    <div 
      class="flex items-center border-4 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden h-14 cursor-pointer select-none font-bold" 
      @click="isTimeBlocking = !isTimeBlocking"
    >
      <div 
        class="px-4 h-full flex items-center transition-colors"
        :class="isTimeBlocking ? 'bg-[#ffdb58] text-black border-r-4 border-black' : 'text-gray-500 bg-transparent border-r-4 border-black hover:bg-gray-100'"
      >
        Focar Agora
      </div>
      <div 
        class="px-4 h-full flex items-center transition-colors"
        :class="!isTimeBlocking ? 'bg-[#ffdb58] text-black' : 'text-gray-500 bg-transparent hover:bg-gray-100'"
      >
        Prazo Final
      </div>
    </div>
    
    <button 
      @click="onSubmit"
      class="h-14 px-8 border-4 border-black bg-[#3b82f6] text-white font-black text-xl uppercase shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[4px] hover:translate-y-[4px] active:shadow-none active:translate-x-[6px] active:translate-y-[6px] transition-all"
    >
      Delegar Quest
    </button>
  </div>
</template>
