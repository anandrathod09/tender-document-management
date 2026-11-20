import './assets/main.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { buildRouter } from './router'
import { setSessionExpiredHandler } from './services/api'
import { useAuthStore } from './stores/auth'
import { useWorkspaceStore } from './stores/workspace'

async function start() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // Which workspace is this address? The screens depend on the answer.
  const workspace = useWorkspaceStore()
  await workspace.load()

  const router = buildRouter(workspace.info)
  app.use(router)

  setSessionExpiredHandler(() => {
    useAuthStore().clear()
    const here = router.currentRoute.value
    if (!here.meta.guest) void router.push({ path: '/signin', query: { redirect: here.fullPath } })
  })

  await router.isReady()
  app.mount('#app')
}

void start()
