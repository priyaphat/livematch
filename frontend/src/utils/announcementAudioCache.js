export function createAnnouncementAudioCache(loadBlob, objectURL = {}) {
  const urls = new Map()
  const requests = new Map()
  const createObjectURL = objectURL.create || ((blob) => URL.createObjectURL(blob))
  const revokeObjectURL = objectURL.revoke || ((url) => URL.revokeObjectURL?.(url))

  return {
    async get(key) {
      if (urls.has(key)) return urls.get(key)
      if (requests.has(key)) return requests.get(key)

      const request = (async () => {
        const blob = await loadBlob(key)
        const url = createObjectURL(blob)
        urls.set(key, url)
        return url
      })().finally(() => {
        requests.delete(key)
      })
      requests.set(key, request)
      return request
    },
    dispose() {
      for (const url of urls.values()) revokeObjectURL(url)
      urls.clear()
      requests.clear()
    }
  }
}
