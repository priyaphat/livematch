<script setup>
import { onUnmounted, ref } from 'vue'
import { ImagePlus, Send, Trash2, X } from '@lucide/vue'

const props = defineProps(['submitSupportIssue'])
const emit = defineEmits(['close'])

const title = ref('')
const details = ref('')
const contact = ref('')
const images = ref([])
const loading = ref(false)
const error = ref('')
const submittedId = ref('')

function revokePreviews() {
  images.value.forEach((item) => URL.revokeObjectURL(item.preview))
}

function addImages(event) {
  error.value = ''
  const files = [...(event.target.files || [])]
  if (images.value.length + files.length > 5) {
    error.value = 'แนบรูปได้สูงสุด 5 รูป'
    event.target.value = ''
    return
  }
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      error.value = 'รองรับเฉพาะรูป JPG, PNG และ WebP'
      event.target.value = ''
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      error.value = 'รูปแต่ละไฟล์ต้องมีขนาดไม่เกิน 3MB'
      event.target.value = ''
      return
    }
  }
  images.value.push(...files.map((file) => ({ file, preview: URL.createObjectURL(file) })))
  event.target.value = ''
}

function removeImage(index) {
  URL.revokeObjectURL(images.value[index].preview)
  images.value.splice(index, 1)
}

function close() {
  revokePreviews()
  emit('close')
}

async function submit() {
  error.value = ''
  if (!title.value.trim() || !details.value.trim() || !contact.value.trim()) {
    error.value = 'กรุณากรอกชื่อปัญหา รายละเอียด และช่องทางติดต่อกลับ'
    return
  }
  loading.value = true
  try {
    const body = new FormData()
    body.append('title', title.value.trim())
    body.append('details', details.value.trim())
    body.append('contact', contact.value.trim())
    images.value.forEach((item) => body.append('images', item.file))
    const result = await props.submitSupportIssue(body)
    submittedId.value = result.id
    revokePreviews()
    images.value = []
  } catch (submitError) {
    error.value = submitError?.message || 'ส่งรายการแจ้งปัญหาไม่สำเร็จ'
  } finally {
    loading.value = false
  }
}

onUnmounted(revokePreviews)
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-end bg-stone-950/50 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-label="ติดต่อแอดมิน แจ้งปัญหา" @click.self="close">
    <div class="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-black text-court-700 dark:text-court-300">ติดต่อแอดมิน</p>
          <h2 class="mt-1 text-2xl font-black">แจ้งปัญหาการใช้งาน</h2>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">แจ้งรายละเอียดและช่องทางติดต่อกลับ ทีมงานจะตรวจสอบให้เร็วที่สุด</p>
        </div>
        <button class="grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="ปิด" @click="close">
          <X class="h-5 w-5" />
        </button>
      </div>

      <div v-if="submittedId" class="mt-5 rounded-md border border-court-200 bg-court-500/10 p-4 dark:border-court-900/60">
        <p class="font-black text-court-700 dark:text-court-300">ส่งรายการสำเร็จ</p>
        <p class="mt-1 text-sm font-semibold">เลขรายการ: {{ submittedId }}</p>
        <button class="mt-4 h-10 rounded-md bg-court-500 px-4 text-sm font-black text-white" @click="close">ปิดหน้าต่าง</button>
      </div>

      <form v-else class="mt-5 grid gap-4" @submit.prevent="submit">
        <label class="grid gap-2 text-sm font-black">
          ชื่อปัญหา
          <input v-model="title" maxlength="200" required class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" placeholder="สรุปปัญหาที่พบ" />
        </label>
        <label class="grid gap-2 text-sm font-black">
          รายละเอียด
          <textarea v-model="details" maxlength="5000" required rows="5" class="rounded-md border border-stone-200 bg-paper-50 p-3 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" placeholder="เกิดอะไรขึ้น อยู่หน้าไหน และลองแก้ไขอย่างไรแล้ว" />
        </label>
        <label class="grid gap-2 text-sm font-black">
          ติดต่อกลับ
          <input v-model="contact" maxlength="500" required class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" placeholder="LINE, Facebook, เบอร์โทร หรืออีเมล" />
        </label>

        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-black">รูปประกอบ</p>
            <span class="text-xs font-bold text-stone-500">{{ images.length }} / 5 รูป</span>
          </div>
          <label class="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 bg-paper-50 p-4 text-center dark:border-stone-700 dark:bg-stone-800">
            <ImagePlus class="h-6 w-6 text-court-600" />
            <span class="text-sm font-black">เลือกรูป JPG, PNG หรือ WebP</span>
            <span class="text-xs font-semibold text-stone-500">สูงสุด 5 รูป รูปละไม่เกิน 3MB</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple class="hidden" @change="addImages" />
          </label>
          <div v-if="images.length" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div v-for="(item, index) in images" :key="item.preview" class="relative aspect-square overflow-hidden rounded-md border border-stone-200 dark:border-stone-700">
              <img :src="item.preview" alt="รูปประกอบปัญหา" class="h-full w-full object-cover" />
              <button type="button" class="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md bg-stone-950/80 text-white" title="ลบรูป" @click="removeImage(index)">
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <p v-if="error" class="rounded-md bg-red-50 p-3 text-sm font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ error }}</p>
        <button class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-court-500 px-5 font-black text-white disabled:cursor-wait disabled:opacity-60" :disabled="loading">
          <Send class="h-5 w-5" />
          {{ loading ? 'กำลังส่ง...' : 'ส่งรายการแจ้งปัญหา' }}
        </button>
      </form>
    </div>
  </div>
</template>
