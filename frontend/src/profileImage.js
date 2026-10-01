export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PROFILE_IMAGE_MAX_DIMENSION = 720

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('ไม่สามารถอ่านรูปโปรไฟล์ได้'))
    }
    image.src = url
  })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('บีบอัดรูปโปรไฟล์ไม่สำเร็จ'))
    }, type, quality)
  })
}

export async function compressProfileImage(file) {
  if (!file) throw new Error('กรุณาเลือกรูปโปรไฟล์')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('รองรับเฉพาะรูป JPEG, PNG หรือ WebP')
  }
  if (file.size > PROFILE_IMAGE_MAX_BYTES) {
    throw new Error('รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5 MB')
  }

  const image = await loadImage(file)
  const sourceWidth = Number(image.naturalWidth || image.width || 0)
  const sourceHeight = Number(image.naturalHeight || image.height || 0)
  if (!sourceWidth || !sourceHeight) throw new Error('ไฟล์รูปโปรไฟล์ไม่ถูกต้อง')

  const scale = Math.min(1, PROFILE_IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('อุปกรณ์นี้ไม่รองรับการบีบอัดรูป')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  const blob = await canvasBlob(canvas, 'image/jpeg', 0.84)
  return new File([blob], 'profile-avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() })
}

export async function uploadCompressedProfileImage(apiRequest, path, file) {
  const compressed = await compressProfileImage(file)
  const formData = new FormData()
  formData.append('avatar', compressed)
  return apiRequest(path, { method: 'POST', body: formData })
}
