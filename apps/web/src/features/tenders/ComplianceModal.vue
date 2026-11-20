<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  CompanySummary,
  CompliancePackSummary,
  FileSummary,
  LetterLibrary,
  TenderDetail,
} from '@tdm/shared'
import { COMPLIANCE_LETTERS } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  open: boolean
  tender: TenderDetail
  companies: CompanySummary[]
  tenderDocs: FileSummary[]
}>()
const emit = defineEmits<{ close: []; requested: [pack: CompliancePackSummary] }>()

const companyId = ref('')
const departmentAddress = ref('')
const letters = ref<string[]>([])
/** The client's own letters (letter templates) chosen. */
const templateIds = ref<string[]>([])
const letterLibrary = ref<LetterLibrary | null>(null)
const canManageLetters = useAuthStore().can(PERMISSIONS.COMPANY_MANAGE)
const libraryIds = ref<string[]>([])
const tenderIds = ref<string[]>([])
const library = ref<FileSummary[]>([])
const error = ref('')
const saving = ref(false)

const activeCompanies = computed(() => props.companies.filter((c) => c.isActive))
const company = computed(() => activeCompanies.value.find((c) => c.id === companyId.value))
// Library documents shared by all companies, plus those of the chosen company.
const libraryForCompany = computed(() =>
  library.value.filter((d) => !d.companyId || d.companyId === companyId.value),
)
const mergeable = (d: FileSummary) =>
  d.mimeType === 'application/pdf' || d.mimeType.startsWith('image/')
// Built-in letters the client has not hidden, and their own letters for this company.
const builtins = computed(() =>
  letterLibrary.value
    ? letterLibrary.value.builtins.filter((b) => !b.hidden)
    : COMPLIANCE_LETTERS.map((l) => ({ key: l.key as string, title: l.title, hidden: false })),
)
const ownLetters = computed(() =>
  (letterLibrary.value?.templates ?? []).filter(
    (t) => t.isActive && (!t.company || t.company.id === companyId.value),
  ),
)
watch(companyId, () => {
  const allowed = new Set(ownLetters.value.map((t) => t.id))
  templateIds.value = templateIds.value.filter((id) => allowed.has(id))
})
const letterCount = computed(() => builtins.value.length + ownLetters.value.length)
const total = computed(
  () =>
    letters.value.length +
    templateIds.value.length +
    libraryIds.value.length +
    tenderIds.value.length,
)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    companyId.value = props.tender.biddingCompany?.id ?? activeCompanies.value[0]?.id ?? ''
    departmentAddress.value = ''
    letters.value = ['tender_acceptance']
    templateIds.value = []
    libraryIds.value = []
    tenderIds.value = []
    error.value = ''
    try {
      const [lib, lettersRes] = await Promise.all([
        api.get<FileSummary[]>('/library'),
        api.get<LetterLibrary>('/letter-templates'),
      ])
      library.value = lib.data
      letterLibrary.value = lettersRes.data
      if (!builtins.value.some((b) => b.key === 'tender_acceptance')) letters.value = []
    } catch (err) {
      error.value = errorMessage(err)
    }
  },
)

const missing = computed(() => {
  const c = company.value
  if (!c) return []
  return [!c.logoFileId && 'logo', !c.signatureFileId && 'signature'].filter(Boolean) as string[]
})

const allLetters = computed(
  () => letters.value.length + templateIds.value.length === letterCount.value,
)
function toggleAllLetters() {
  const all = allLetters.value
  letters.value = all ? [] : builtins.value.map((b) => b.key)
  templateIds.value = all ? [] : ownLetters.value.map((t) => t.id)
}

async function submit() {
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.post<CompliancePackSummary>(
      `/tenders/${props.tender.id}/compliance-packs`,
      {
        companyId: companyId.value,
        departmentAddress: departmentAddress.value,
        // Keep the order shown on screen.
        letters: builtins.value.filter((b) => letters.value.includes(b.key)).map((b) => b.key),
        templateIds: ownLetters.value
          .filter((t) => templateIds.value.includes(t.id))
          .map((t) => t.id),
        libraryFileIds: libraryForCompany.value
          .filter((d) => libraryIds.value.includes(d.id))
          .map((d) => d.id),
        tenderFileIds: props.tenderDocs
          .filter((d) => tenderIds.value.includes(d.id))
          .map((d) => d.id),
      },
    )
    emit('requested', data)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" title="Create compliance PDF" width="lg" @close="emit('close')">
    <form id="compliance-form" class="space-y-5" @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiSelect
          v-model="companyId"
          label="Letterhead of"
          :options="activeCompanies.map((c) => ({ value: c.id, label: c.name }))"
          required
        />
        <div>
          <label
            for="dept-address"
            class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Department address
          </label>
          <textarea
            id="dept-address"
            v-model="departmentAddress"
            rows="2"
            maxlength="500"
            class="form-field h-auto"
            placeholder="Printed under the buyer's name in the To, block"
          />
        </div>
      </div>
      <UiAlert v-if="missing.length" variant="warning">
        {{ company?.name }} has no {{ missing.join(' or ') }} yet; letters will be printed without
        it.
      </UiAlert>

      <fieldset>
        <div class="mb-2 flex items-center justify-between">
          <legend class="text-sm font-medium text-gray-800 dark:text-white/90">
            Declaration letters
          </legend>
          <div class="flex items-center gap-4">
            <RouterLink
              v-if="canManageLetters"
              to="/settings/letters"
              class="text-theme-xs font-medium text-gray-500 hover:text-brand-500"
            >
              Manage letters
            </RouterLink>
            <button
              type="button"
              class="text-theme-xs font-medium text-brand-500"
              @click="toggleAllLetters"
            >
              {{ allLetters ? 'Clear all' : 'Select all' }}
            </button>
          </div>
        </div>
        <div class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <label
            v-for="l in builtins"
            :key="l.key"
            class="flex items-start gap-2 text-theme-sm text-gray-700 dark:text-gray-300"
          >
            <input
              v-model="letters"
              type="checkbox"
              :value="l.key"
              class="mt-0.5 size-4 rounded border-gray-300 accent-brand-500"
            />
            {{ l.title }}
          </label>
        </div>
        <template v-if="ownLetters.length">
          <p class="mt-4 mb-2 text-theme-xs font-medium tracking-wider text-gray-500 uppercase">
            Your letters
          </p>
          <div class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <label
              v-for="t in ownLetters"
              :key="t.id"
              class="flex items-start gap-2 text-theme-sm text-gray-700 dark:text-gray-300"
            >
              <input
                v-model="templateIds"
                type="checkbox"
                :value="t.id"
                class="mt-0.5 size-4 rounded border-gray-300 accent-brand-500"
              />
              <span>
                {{ t.title }}
                <span v-if="t.company" class="text-theme-xs text-gray-400">
                  · only {{ t.company.name }}
                </span>
              </span>
            </label>
          </div>
        </template>
      </fieldset>

      <fieldset>
        <legend class="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
          From the document library
        </legend>
        <p v-if="!libraryForCompany.length" class="text-theme-sm text-gray-500 dark:text-gray-400">
          Nothing in the library for this company yet.
        </p>
        <div class="custom-scrollbar max-h-44 space-y-2 overflow-y-auto">
          <label
            v-for="d in libraryForCompany"
            :key="d.id"
            :class="[
              'flex items-start gap-2 text-theme-sm',
              mergeable(d) ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400',
            ]"
          >
            <input
              v-model="libraryIds"
              type="checkbox"
              :value="d.id"
              :disabled="!mergeable(d)"
              class="mt-0.5 size-4 rounded border-gray-300"
            />
            {{ d.title }}
            <span v-if="!mergeable(d)" class="text-theme-xs"
              >(only PDFs and images can be merged)</span
            >
          </label>
        </div>
      </fieldset>

      <fieldset v-if="tenderDocs.length">
        <legend class="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
          This tender's documents
        </legend>
        <div class="space-y-2">
          <label
            v-for="d in tenderDocs"
            :key="d.id"
            :class="[
              'flex items-start gap-2 text-theme-sm',
              mergeable(d) ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400',
            ]"
          >
            <input
              v-model="tenderIds"
              type="checkbox"
              :value="d.id"
              :disabled="!mergeable(d)"
              class="mt-0.5 size-4 rounded border-gray-300"
            />
            {{ d.title }}
          </label>
        </div>
      </fieldset>
    </form>
    <template #footer>
      <p class="mr-auto self-center text-theme-xs text-gray-500 dark:text-gray-400">
        {{ total }} selected
      </p>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton
        type="submit"
        form="compliance-form"
        :disabled="!companyId || total === 0"
        :loading="saving"
      >
        Build PDF
      </UiButton>
    </template>
  </UiModal>
</template>
