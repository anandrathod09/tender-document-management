<script setup lang="ts">
import { Building, Building2, Plus } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { CompanyLimit, CompanySummary } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import StoredImage from '@/components/StoredImage.vue'
import { ACTION_ICONS } from '@/components/ui/actions'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { vTooltip } from '@/directives/tooltip'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import CompanyModal from './CompanyModal.vue'

const auth = useAuthStore()
const canManage = auth.can(PERMISSIONS.COMPANY_MANAGE)
const companies = ref<CompanySummary[]>([])
const loading = ref(true)
const error = ref('')
const editing = ref<CompanySummary | null | 'new'>(null)
const limit = ref<CompanyLimit | null>(null)

async function loadLimit() {
  try {
    limit.value = (await api.get<CompanyLimit>('/companies/limit')).data
  } catch {
    // The page works without it; the server still enforces the limit.
  }
}
const atLimit = computed(() => !!limit.value && limit.value.used >= limit.value.max)

onMounted(async () => {
  void loadLimit()
  try {
    companies.value = (await api.get<CompanySummary[]>('/companies')).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
})

function onSaved(c: CompanySummary) {
  const i = companies.value.findIndex((x) => x.id === c.id)
  if (i >= 0) companies.value[i] = c
  else companies.value = [...companies.value, c].sort((a, b) => a.name.localeCompare(b.name))
  // Keep the modal open on the saved company so images can be added next.
  editing.value = c
  void loadLimit()
}
</script>

<template>
  <div>
    <PageHeader
      title="Bidding Companies"
      :icon="Building"
      description="The companies you bid under. Their letterhead, logo and signature are used on compliance letters."
    >
      <template v-if="canManage" #actions>
        <span
          v-if="limit"
          :class="['text-sm', atLimit ? 'text-orange-600' : 'text-gray-500 dark:text-gray-400']"
        >
          {{ limit.used }} of {{ limit.max }} active companies on your plan
        </span>
        <span
          v-tooltip="
            atLimit
              ? 'Your plan limit is reached. Mark a company inactive or upgrade the plan.'
              : null
          "
        >
          <UiButton :disabled="atLimit" @click="editing = 'new'"
            ><Plus class="size-4" aria-hidden="true" /> Add company</UiButton
          >
        </span>
      </template>
    </PageHeader>

    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="c in companies"
        :key="c.id"
        :class="[
          'rounded-md border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]',
          !c.isActive && 'opacity-60',
        ]"
      >
        <div class="flex items-start gap-4">
          <div
            class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 dark:bg-white/5"
          >
            <StoredImage v-if="c.logoFileId" :file-id="c.logoFileId" :alt="`${c.name} logo`" />
            <Building2 v-else class="size-6 text-gray-400" aria-hidden="true" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-base font-semibold text-gray-800 dark:text-white/90">
              {{ c.name }}
            </h2>
            <p class="line-clamp-2 text-theme-xs text-gray-500 dark:text-gray-400">
              {{ c.address }}
            </p>
          </div>
          <IconButton
            v-if="canManage"
            :icon="ACTION_ICONS.edit"
            :label="`Edit ${c.name}`"
            @click="editing = c"
          />
        </div>
        <dl class="mt-4 grid grid-cols-2 gap-3 text-theme-xs">
          <div>
            <dt class="text-gray-500 dark:text-gray-400">Signatory</dt>
            <dd class="text-gray-800 dark:text-white/90">
              {{ c.signatoryName }}, {{ c.designation }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">GSTIN</dt>
            <dd class="text-gray-800 dark:text-white/90">{{ c.gstin ?? '—' }}</dd>
          </div>
        </dl>
        <div class="mt-4 flex flex-wrap gap-2">
          <UiBadge v-if="!c.isActive">Inactive</UiBadge>
          <UiBadge v-if="!c.logoFileId" color="warning">No logo</UiBadge>
          <UiBadge v-if="!c.signatureFileId" color="warning">No signature</UiBadge>
        </div>
      </article>
    </div>

    <div
      v-if="!loading && !companies.length"
      class="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <EmptyState
        title="No companies yet"
        description="Add each company you bid under, with its logo and signature, to print compliance letters on its letterhead."
      >
        <UiButton v-if="canManage" @click="editing = 'new'">Add company</UiButton>
      </EmptyState>
    </div>

    <CompanyModal
      :company="editing === 'new' ? null : editing"
      :open="editing !== null"
      @close="editing = null"
      @saved="onSaved"
    />
  </div>
</template>
