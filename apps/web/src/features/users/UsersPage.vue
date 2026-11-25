<script setup lang="ts">
import { CircleCheck, Clock, Pause, Search, ShieldCheck, UserPlus, Users } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { RoleSummary, UserSummary, WorkspaceSettings } from '@tdm/shared'
import { isEngineerRole, PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import CopyField from '@/components/ui/CopyField.vue'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ModalCallout from '@/components/ui/ModalCallout.vue'
import { sortLocal, type TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { vTooltip } from '@/directives/tooltip'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { formatDate, formatDateTime, userStatusBadge } from '@/utils/format'
import EditUserModal from './EditUserModal.vue'
import InviteUserModal from './InviteUserModal.vue'

const auth = useAuthStore()
const users = ref<UserSummary[]>([])
const roles = ref<RoleSummary[]>([])
/** Engineers without a phone number: admins cannot call them about installations. */
const missingPhone = (u: UserSummary) =>
  !u.phone && isEngineerRole(roles.value.find((r) => r.id === u.role.id)?.permissions ?? [])
const loading = ref(true)
const loadError = ref('')

const inviteOpen = ref(false)
const editing = ref<UserSummary | null>(null)
/** Link to show after inviting or resending, so the admin can also share it directly. */
const shared = ref<{ name: string; url: string } | null>(null)
const actionError = ref('')
const notice = ref('')
const toggling = ref<UserSummary | null>(null)
const togglingBusy = ref(false)
const resetting = ref<UserSummary | null>(null)
const resettingBusy = ref(false)

// Whether two-step login is required (changed on the Settings page), for the reset message.
const canSettings = auth.can(PERMISSIONS.SETTINGS_MANAGE)
const settings = ref<WorkspaceSettings | null>(null)
async function loadSettings() {
  if (!canSettings) return
  try {
    settings.value = (await api.get<WorkspaceSettings>('/workspace/settings')).data
  } catch {
    // Not critical for the user list.
  }
}
const twoFactorCount = computed(() => users.value.filter((u) => u.twoFactorEnabled).length)

async function confirmReset() {
  const u = resetting.value
  if (!u) return
  actionError.value = ''
  resettingBusy.value = true
  try {
    const { data } = await api.post<UserSummary>(`/users/${u.id}/reset-two-factor`)
    replace(data)
    notice.value = `Two-step login reset for ${u.name}. They have been signed out.`
  } catch (err) {
    actionError.value = errorMessage(err)
  } finally {
    resettingBusy.value = false
    resetting.value = null
  }
}

// Filters, as on the original TMS user screen.
const roleFilter = ref('')
const statusFilter = ref('')
const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return users.value.filter(
    (u) =>
      (!roleFilter.value || u.role.id === roleFilter.value) &&
      (!statusFilter.value || u.status === statusFilter.value) &&
      (!q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone ?? '').includes(q)),
  )
})
const filtering = computed(() => !!(roleFilter.value || statusFilter.value || search.value))
function clearFilters() {
  roleFilter.value = ''
  statusFilter.value = ''
  search.value = ''
}

const stats = computed(() => ({
  total: users.value.length,
  active: users.value.filter((u) => u.status === 'active').length,
  suspended: users.value.filter((u) => u.status === 'suspended').length,
  invited: users.value.filter((u) => u.status === 'invited').length,
  byRole: roles.value.map((r) => ({
    role: r,
    count: users.value.filter((u) => u.role.id === r.id).length,
  })),
}))

const sort = ref('name')
const columns: TableColumn[] = [
  { key: 'name', label: 'User', sort: true, sticky: true, class: 'min-w-60' },
  { key: 'role', label: 'Role', sort: true },
  { key: 'status', label: 'Status', sort: true },
  { key: 'createdAt', label: 'Created On', sort: true },
  { key: 'lastLoginAt', label: 'Last Login', sort: true },
]
const sorted = computed(() =>
  sortLocal(filtered.value, sort.value, {
    name: (u) => u.name,
    role: (u) => u.role.name,
    status: (u) => userStatusBadge[u.status].label,
    createdAt: (u) => Date.parse(u.createdAt),
    lastLoginAt: (u) => (u.lastLoginAt ? Date.parse(u.lastLoginAt) : null),
  }),
)
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [u, r] = await Promise.all([
      api.get<UserSummary[]>('/users'),
      api.get<RoleSummary[]>('/roles'),
    ])
    users.value = u.data
    roles.value = r.data
  } catch (err) {
    loadError.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  void load()
  void loadSettings()
})

function replace(updated: UserSummary) {
  users.value = users.value.map((u) => (u.id === updated.id ? updated : u))
}

function onInvited(result: { user: UserSummary; inviteUrl: string }) {
  inviteOpen.value = false
  users.value.push(result.user)
  shared.value = { name: result.user.name, url: result.inviteUrl }
}

function onSaved(updated: UserSummary) {
  editing.value = null
  replace(updated)
  notice.value = `${updated.name} updated successfully`
}

async function resend(user: UserSummary) {
  actionError.value = ''
  try {
    const { data } = await api.post<{ inviteUrl: string }>(`/users/${user.id}/resend-invite`)
    shared.value = { name: user.name, url: data.inviteUrl }
  } catch (err) {
    actionError.value = errorMessage(err)
  }
}

async function confirmToggle() {
  const u = toggling.value
  if (!u) return
  actionError.value = ''
  togglingBusy.value = true
  try {
    const status = u.status === 'suspended' ? 'active' : 'suspended'
    const { data } = await api.patch<UserSummary>(`/users/${u.id}`, { status })
    replace(data)
    notice.value =
      status === 'active' ? `${u.name} can sign in again` : `${u.name} has been suspended`
    toggling.value = null
  } catch (err) {
    actionError.value = errorMessage(err)
    toggling.value = null
  } finally {
    togglingBusy.value = false
  }
}
</script>

<template>
  <div>
    <UiAlert v-if="loadError" class="mb-4">{{ loadError }}</UiAlert>
    <UiAlert v-if="actionError" class="mb-4">{{ actionError }}</UiAlert>
    <UiAlert v-if="notice" variant="success" class="mb-4">{{ notice }}</UiAlert>

    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UiStatCard title="Total Users" :value="stats.total" :icon="Users" />
      <UiStatCard
        v-for="r in stats.byRole"
        :key="r.role.id"
        :title="r.role.name"
        :value="r.count"
        :icon="Users"
      />
      <UiStatCard title="Active" :value="stats.active" :icon="CircleCheck" />
      <UiStatCard title="Suspended" :value="stats.suspended" :icon="Pause" />
      <UiStatCard title="Pending Setup" :value="stats.invited" :icon="Clock" />
      <UiStatCard title="Two-Step Login On" :value="twoFactorCount" :icon="ShieldCheck" />
    </div>

    <UiCard
      :level="1"
      title="User Management"
      :icon="Users"
      :subtitle="`${filtered.length} of ${users.length} users`"
    >
      <template #header>
        <UiSelect
          v-model="roleFilter"
          aria-label="Filter by role"
          size="sm"
          class="w-40"
          :options="[
            { value: '', label: 'All roles' },
            ...roles.map((r) => ({ value: r.id, label: r.name })),
          ]"
        />
        <UiSelect
          v-model="statusFilter"
          aria-label="Filter by status"
          size="sm"
          class="w-40"
          :options="[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'invited', label: 'Invited' },
            { value: 'suspended', label: 'Suspended' },
          ]"
        />
        <label class="relative w-full sm:w-48">
          <span class="sr-only">Search users</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            v-model="search"
            type="search"
            placeholder="Search users..."
            class="form-field h-9! py-1! pl-9! text-sm!"
          />
        </label>
        <UiButton size="xs" variant="ghost" :disabled="!filtering" @click="clearFilters">
          Clear Filters
        </UiButton>
        <UiButton size="xs" :disabled="!roles.length" @click="inviteOpen = true">
          <UserPlus class="size-4" aria-hidden="true" /> Add User
        </UiButton>
      </template>

      <DataTable
        v-model:sort="sort"
        :columns="columns"
        :rows="sorted"
        :loading="loading"
        loading-text="Loading users..."
      >
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300"
              aria-hidden="true"
            >
              {{ initials(row.name) }}
            </span>
            <div class="flex min-w-0 flex-col text-xs">
              <span class="font-medium">
                {{ row.name }}
                <span v-if="row.id === auth.user?.id" class="font-normal text-gray-400">(you)</span>
              </span>
              <span class="text-gray-500 dark:text-gray-400">{{ row.email }}</span>
              <span v-if="row.phone" class="mt-1 text-gray-400">{{ row.phone }}</span>
              <span
                v-else-if="missingPhone(row)"
                class="mt-1 text-[#FC9A1D]"
                title="Engineers need a phone number. Edit the user to add it."
                >No phone number: add one</span
              >
              <span
                v-if="row.twoFactorEnabled"
                class="mt-1 inline-flex items-center gap-1 text-[#7AA90D]"
              >
                <ShieldCheck class="size-3.5" aria-hidden="true" /> 2-step login on
              </span>
            </div>
          </div>
        </template>
        <template #cell-role="{ row }">
          <UiBadge color="info">{{ row.role.name }}</UiBadge>
        </template>
        <template #cell-status="{ row }">
          <UiBadge :color="userStatusBadge[row.status].color">
            {{ row.status === 'invited' ? 'Pending' : userStatusBadge[row.status].label }}
          </UiBadge>
        </template>
        <template #cell-createdAt="{ row }">
          <span class="text-xs whitespace-nowrap">{{ formatDate(row.createdAt) }}</span>
        </template>
        <template #cell-lastLoginAt="{ row }">
          <span class="text-xs whitespace-nowrap">{{ formatDateTime(row.lastLoginAt) }}</span>
        </template>
        <template #actions="{ row }">
          <IconButton :icon="ACTION_ICONS.edit" label="Edit User" @click="editing = row" />
          <IconButton
            v-if="row.id !== auth.user?.id && row.status !== 'invited'"
            :icon="ACTION_ICONS.toggle"
            :label="row.status === 'suspended' ? 'Activate User' : 'Suspend User'"
            :variant="row.status === 'suspended' ? 'primary' : 'default'"
            @click="toggling = row"
          />
          <IconButton
            v-if="row.status === 'invited'"
            :icon="ACTION_ICONS.resend"
            label="Resend Invitation"
            @click="resend(row)"
          />
          <IconButton
            v-if="row.twoFactorEnabled && row.id !== auth.user?.id"
            :icon="ACTION_ICONS.reset"
            label="Reset Two-Step Login"
            @click="resetting = row"
          />
        </template>
        <template #empty>
          <EmptyState
            v-if="!loadError"
            :icon="Users"
            :title="filtering ? 'No users found' : 'No users yet'"
            :description="
              filtering ? 'Try different filters.' : 'Invite your team to start working together.'
            "
          />
        </template>
      </DataTable>
    </UiCard>

    <InviteUserModal
      :open="inviteOpen"
      :roles="roles"
      @close="inviteOpen = false"
      @invited="onInvited"
    />
    <EditUserModal
      :user="editing"
      :roles="roles"
      :is-self="editing?.id === auth.user?.id"
      @close="editing = null"
      @saved="onSaved"
    />

    <UiModal
      :open="!!toggling"
      :title="`${toggling?.status === 'suspended' ? 'Activate' : 'Suspend'} User: ${toggling?.name ?? ''}`"
      :busy="togglingBusy"
      @close="toggling = null"
    >
      <ModalCallout
        :tone="toggling?.status === 'suspended' ? 'info' : 'warning'"
        :lead="toggling?.status === 'suspended' ? 'Activate: ' : 'Warning: '"
      >
        <template v-if="toggling?.status === 'suspended'">
          {{ toggling?.name }} will be able to sign in again with their password.
        </template>
        <template v-else>
          {{ toggling?.name }} will be signed out straight away and cannot sign in until activated
          again. Their tenders stay assigned to them.
        </template>
      </ModalCallout>
      <template #footer>
        <UiButton variant="secondary" :disabled="togglingBusy" @click="toggling = null">
          Cancel
        </UiButton>
        <UiButton
          :variant="toggling?.status === 'suspended' ? 'primary' : 'danger'"
          :loading="togglingBusy"
          @click="confirmToggle"
        >
          {{ toggling?.status === 'suspended' ? 'Activate User' : 'Suspend User' }}
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="!!resetting"
      :title="`Reset Two-Step Login: ${resetting?.name ?? ''}`"
      :busy="resettingBusy"
      @close="resetting = null"
    >
      <ModalCallout tone="warning" lead="Warning: ">
        Use this when {{ resetting?.name }} has lost their phone and backup codes. Two-step login is
        turned off for them and they are signed out everywhere. They can sign in again with their
        password<template v-if="settings?.requireTwoFactor">
          and will be asked to set up two-step login again</template
        >.
      </ModalCallout>
      <template #footer>
        <UiButton variant="secondary" :disabled="resettingBusy" @click="resetting = null">
          Cancel
        </UiButton>
        <UiButton variant="danger" :loading="resettingBusy" @click="confirmReset">
          Reset Two-Step Login
        </UiButton>
      </template>
    </UiModal>

    <UiModal :open="!!shared" title="Invitation sent" @close="shared = null">
      <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
        We emailed {{ shared?.name }} a link to set their password. You can also share this link
        with them directly. It works for 72 hours.
      </p>
      <CopyField v-if="shared" :value="shared.url" label="Invitation link" />
      <template #footer>
        <UiButton @click="shared = null">Done</UiButton>
      </template>
    </UiModal>
  </div>
</template>
