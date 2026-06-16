<script setup>
defineProps([
  'state',
  'playerName'
])
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[860px] text-left text-sm">
        <thead class="bg-paper-100 text-stone-500 dark:bg-stone-800 dark:text-stone-300">
          <tr>
            <th class="p-3">เกมที่</th>
            <th class="p-3">สนาม</th>
            <th class="p-3">A1</th>
            <th class="p-3">A2</th>
            <th class="p-3">B1</th>
            <th class="p-3">B2</th>
            <th class="p-3">เริ่ม</th>
            <th class="p-3">จบ</th>
            <th class="p-3">ลูก</th>
            <th class="p-3">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="match in state.history" :key="match.id" class="border-t border-stone-100 dark:border-stone-800">
            <td class="p-3">{{ match.id }}</td>
            <td class="p-3">{{ match.court }}</td>
            <td class="p-3">{{ playerName(match.a1) }}</td>
            <td class="p-3">{{ playerName(match.a2) }}</td>
            <td class="p-3">{{ playerName(match.b1) }}</td>
            <td class="p-3">{{ playerName(match.b2) }}</td>
            <td class="p-3">{{ match.startedAt }}</td>
            <td class="p-3">{{ match.endedAt }}</td>
            <td class="p-3">{{ match.shuttles }}</td>
            <td class="p-3">{{ match.note }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
