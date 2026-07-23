<script setup>
import courtHero from '../assets/livematch-court-hero.webp'
import courtHeroDark from '../assets/livematch-court-hero-dark.webp'
import courtHeroFallback from '../assets/livematch-court-hero.png'
import courtHeroDarkFallback from '../assets/livematch-court-hero-dark.png'
</script>

<template>
  <div class="lm-hero-media" aria-hidden="true">
    <picture><source type="image/webp" :srcset="courtHero"><img class="lm-hero-media__image lm-hero-media__image--light" :src="courtHeroFallback" alt="" /></picture>
    <picture><source type="image/webp" :srcset="courtHeroDark"><img class="lm-hero-media__image lm-hero-media__image--dark" :src="courtHeroDarkFallback" alt="" /></picture>
  </div>
</template>
