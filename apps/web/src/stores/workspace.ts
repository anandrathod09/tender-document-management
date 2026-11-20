import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkspaceInfo } from '@tdm/shared'
import { api } from '@/services/api'

export type Workspace = WorkspaceInfo | { kind: 'not-found' } | { kind: 'unavailable' }

/** What this browser address is: a client, the owner panel, or nothing we know. */
export const useWorkspaceStore = defineStore('workspace', () => {
  const info = ref<Workspace>({ kind: 'unavailable' })

  async function load() {
    try {
      info.value = (await api.get<WorkspaceInfo>('/workspace')).data
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status
      info.value = status === 404 ? { kind: 'not-found' } : { kind: 'unavailable' }
    }
  }

  return { info, load }
})
