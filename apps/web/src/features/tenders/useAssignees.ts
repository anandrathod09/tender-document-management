import { ref } from 'vue'
import type { Assignee } from '@tdm/shared'
import { api } from '@/services/api'

export type { Assignee }

const people = ref<Assignee[]>([])
const loaded = ref(false)
let loading: Promise<Assignee[]> | null = null

/** Team members tenders can be assigned to; fetched once per page load. */
export function useAssignees() {
  function load(force = false): Promise<Assignee[]> {
    if (force) loading = null
    loading ??= api
      .get<Assignee[]>('/tenders/assignees')
      .then((r) => {
        people.value = r.data
        loaded.value = true
        return r.data
      })
      .catch((err) => {
        loading = null
        throw err
      })
    return loading
  }
  return { people, loaded, load }
}
