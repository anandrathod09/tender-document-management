<script setup lang="ts">
import { ref, watch } from 'vue'
import type { CompanySummary } from '@tdm/shared'
import StoredImage from '@/components/StoredImage.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

const props = defineProps<{ open: boolean; company: CompanySummary | null }>()
const emit = defineEmits<{ close: []; saved: [company: CompanySummary] }>()

const empty = () => ({
  name: '',
  address: '',
  gstin: '',
  pan: '',
  email: '',
  phone: '',
  signatoryName: '',
  designation: '',
  authorizedPerson: '',
  authorizedPersonPosition: '',
  localContentPercent: '',
  localValueLocation: '',
  isActive: true,
})
const form = ref(empty())
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)
const imageError = ref('')
const uploading = ref<'' | 'logo' | 'signature'>('')

watch(
  () => [props.open, props.company?.id] as const,
  ([open]) => {
    if (!open) return
    const c = props.company
    form.value = c
      ? {
          name: c.name,
          address: c.address,
          gstin: c.gstin ?? '',
          pan: c.pan ?? '',
          email: c.email ?? '',
          phone: c.phone ?? '',
          signatoryName: c.signatoryName,
          designation: c.designation,
          authorizedPerson: c.authorizedPerson ?? '',
          authorizedPersonPosition: c.authorizedPersonPosition ?? '',
          localContentPercent: c.localContentPercent ?? '',
          localValueLocation: c.localValueLocation ?? '',
          isActive: c.isActive,
        }
      : empty()
    errors.value = {}
    error.value = ''
    imageError.value = ''
  },
)

async function save() {
  errors.value = {}
  error.value = ''
  saving.value = true
  try {
    const { data } = props.company
      ? await api.put<CompanySummary>(`/companies/${props.company.id}`, form.value)
      : await api.post<CompanySummary>('/companies', form.value)
    emit('saved', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

async function uploadImage(which: 'logo' | 'signature', e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.company) return
  imageError.value = ''
  uploading.value = which
  try {
    const body = new FormData()
    body.append('file', file)
    emit(
      'saved',
      (await api.post<CompanySummary>(`/companies/${props.company.id}/${which}`, body)).data,
    )
  } catch (err) {
    imageError.value = errorMessage(err)
  } finally {
    uploading.value = ''
  }
}
</script>

<template>
  <UiModal
    :open="open"
    :title="company ? `Edit ${company.name}` : 'Add company'"
    width="lg"
    @close="emit('close')"
  >
    <form id="company-form" class="space-y-5" novalidate @submit.prevent="save">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiInput v-model="form.name" label="Company name" :error="errors.name" required />
        <UiInput
          v-model="form.gstin"
          label="GSTIN"
          :error="errors.gstin"
          placeholder="27ABCDE1234F1Z5"
        />
        <div class="sm:col-span-2">
          <UiInput
            v-model="form.address"
            label="Registered address"
            :error="errors.address"
            required
          />
        </div>
        <UiInput v-model="form.pan" label="PAN" :error="errors.pan" />
        <UiInput v-model="form.email" label="Email" type="email" :error="errors.email" />
        <UiInput v-model="form.phone" label="Phone" :error="errors.phone" />
      </div>

      <fieldset class="border-t border-gray-200 pt-5 dark:border-gray-800">
        <legend class="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
          Signs the letters
        </legend>
        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="form.signatoryName"
            label="Signatory name"
            :error="errors.signatoryName"
            required
          />
          <UiInput
            v-model="form.designation"
            label="Designation"
            :error="errors.designation"
            required
          />
          <UiInput
            v-model="form.authorizedPerson"
            label="Authorized person (Power of Attorney)"
            :error="errors.authorizedPerson"
          />
          <UiInput
            v-model="form.authorizedPersonPosition"
            label="Their position"
            :error="errors.authorizedPersonPosition"
          />
          <UiInput
            v-model="form.localContentPercent"
            label="Local content % (Make in India)"
            :error="errors.localContentPercent"
          />
          <UiInput
            v-model="form.localValueLocation"
            label="Local value addition location"
            :error="errors.localValueLocation"
          />
        </div>
      </fieldset>

      <label
        v-if="company"
        class="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300"
      >
        <input v-model="form.isActive" type="checkbox" class="size-4 rounded border-gray-300" />
        Active (inactive companies cannot be chosen for new tenders)
      </label>

      <fieldset v-if="company" class="border-t border-gray-200 pt-5 dark:border-gray-800">
        <legend class="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
          Logo and signature
        </legend>
        <UiAlert v-if="imageError" class="mb-3">{{ imageError }}</UiAlert>
        <div class="grid gap-4 sm:grid-cols-2">
          <div v-for="which in ['logo', 'signature'] as const" :key="which">
            <div
              class="mb-2 flex h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2 dark:border-gray-700 dark:bg-white/5"
            >
              <StoredImage
                v-if="which === 'logo' ? company.logoFileId : company.signatureFileId"
                :file-id="which === 'logo' ? company.logoFileId : company.signatureFileId"
                :alt="which"
              />
              <span v-else class="text-theme-xs text-gray-400">No {{ which }} yet</span>
            </div>
            <label
              class="inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/5"
            >
              {{ uploading === which ? 'Uploading…' : `Upload ${which}` }}
              <input
                type="file"
                accept="image/png,image/jpeg"
                class="sr-only"
                @change="uploadImage(which, $event)"
              />
            </label>
            <p class="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">PNG or JPEG.</p>
          </div>
        </div>
      </fieldset>
      <p v-else class="text-theme-xs text-gray-500 dark:text-gray-400">
        Save the company first, then add its logo and signature.
      </p>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Close</UiButton>
      <UiButton type="submit" form="company-form" :loading="saving">
        {{ company ? 'Save changes' : 'Save company' }}
      </UiButton>
    </template>
  </UiModal>
</template>
