<script setup>
import courtHero from '../assets/livematch-court-hero.png'
import courtHeroDark from '../assets/livematch-court-hero-dark.png'
</script>

<template>
  <div class="lm-hero-media" aria-hidden="true">
    <img class="lm-hero-media__image lm-hero-media__image--light" :src="courtHero" alt="" />
    <img class="lm-hero-media__image lm-hero-media__image--dark" :src="courtHeroDark" alt="" />
  </div>
</template>
