<script setup>
import courtHero from '../assets/livematch-court-hero.webp'
import courtHeroDark from '../assets/livematch-court-hero-dark.webp'
import courtHeroFallback from '../assets/livematch-court-hero.png'
import courtHeroDarkFallback from '../assets/livematch-court-hero-dark.png'

defineProps({
  name: {
    type: String,
    default: 'shuttle'
  },
  tone: {
    type: String,
    default: 'mint'
  }
})

const toneClasses = {
  mint: 'bg-[#f7f4ea] dark:bg-[#11251e]',
  amber: 'bg-[#fbf2df] dark:bg-[#292216]',
  sky: 'bg-[#f3f7f2] dark:bg-[#14231f]',
  coral: 'bg-[#fbefe7] dark:bg-[#2b1e1a]'
}
</script>

<template>
  <div class="lm-illustration relative overflow-hidden rounded-2xl border p-2" :class="toneClasses[tone] || toneClasses.mint">
    <picture class="dark:hidden"><source type="image/webp" :srcset="courtHero"><img
      :src="courtHeroFallback"
      :alt="`${name} illustration`"
      class="h-full min-h-28 w-full rounded-xl object-cover object-right dark:hidden"
      loading="lazy"
    ></picture>
    <picture class="hidden dark:block"><source type="image/webp" :srcset="courtHeroDark"><img
      :src="courtHeroDarkFallback"
      alt=""
      aria-hidden="true"
      class="hidden h-full min-h-28 w-full rounded-xl object-cover object-right dark:block"
      loading="lazy"
    ></picture>
  </div>
</template>
