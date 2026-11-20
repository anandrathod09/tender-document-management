import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LoginChallenge, LoginResponse, Permission, Session } from '@tdm/shared'
import { api, refreshSession, setAccessToken } from '@/services/api'
import { useWorkflowStore } from './workflow'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  let restoring: Promise<void> | null = null

  const isSignedIn = computed(() => session.value !== null)
  const tenant = computed(() => (session.value?.realm === 'tenant' ? session.value : null))
  const platform = computed(() => (session.value?.realm === 'platform' ? session.value : null))
  const user = computed(() => session.value?.user ?? null)
  /** The workspace requires two-step login and this user has not set it up yet. */
  const mustSetUpTwoFactor = computed(
    () => !!session.value?.twoFactor.required && !session.value.twoFactor.enabled,
  )

  function apply(res: LoginResponse) {
    setAccessToken(res.accessToken)
    session.value = res.session
    // Counts depend on who is signed in (agents see only their tenders).
    useWorkflowStore().reset()
  }

  /** Restores the session after a page load, using the refresh cookie. Runs once. */
  function restore(): Promise<void> {
    restoring ??= refreshSession()
      .then((res) => {
        session.value = res.session
      })
      .catch(() => {
        session.value = null
      })
    return restoring
  }

  /**
   * Signs in with the password. Returns a challenge when the account has
   * two-step login; finish with loginTwoFactor().
   */
  async function login(email: string, password: string): Promise<LoginChallenge | null> {
    const { data } = await api.post<LoginResponse | LoginChallenge>('/auth/login', {
      email,
      password,
    })
    if ('twoFactorRequired' in data) return data
    apply(data)
    return null
  }

  async function loginTwoFactor(challengeToken: string, code: string) {
    apply((await api.post<LoginResponse>('/auth/login/2fa', { challengeToken, code })).data)
  }

  /** Updates the session after turning two-step login on or off. */
  function setTwoFactorEnabled(enabled: boolean) {
    if (!session.value) return
    session.value = { ...session.value, twoFactor: { ...session.value.twoFactor, enabled } }
  }

  async function acceptInvite(token: string, password: string) {
    apply((await api.post<LoginResponse>('/auth/accept-invite', { token, password })).data)
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } finally {
      clear()
    }
  }

  function clear() {
    setAccessToken(null)
    session.value = null
    useWorkflowStore().reset()
  }

  function can(permission: Permission): boolean {
    return tenant.value?.permissions.includes(permission) ?? false
  }

  return {
    session,
    isSignedIn,
    tenant,
    platform,
    user,
    restore,
    mustSetUpTwoFactor,
    login,
    loginTwoFactor,
    setTwoFactorEnabled,
    acceptInvite,
    logout,
    clear,
    can,
  }
})
