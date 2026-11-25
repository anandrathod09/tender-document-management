<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RevenueMonth } from '@tdm/shared'

/**
 * Money collected per month of the financial year, one series on one axis.
 * The split (before GST, GST, number of payments) is in the tooltip and the
 * table below the chart.
 */
const props = defineProps<{ rows: RevenueMonth[] }>()

const H = 240
const PAD = { top: 12, right: 12, bottom: 28, left: 64 }
const root = ref<HTMLElement | null>(null)
const width = ref(640)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(
    ([e]) => (width.value = Math.max(300, Math.floor(e!.contentRect.width))),
  )
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })
const longFmt = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const asDate = (m: string) => new Date(`${m}-01T00:00:00Z`)
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

const max = computed(() => Math.max(1, ...props.rows.map((r) => r.totalAmount)))
/** A "nice" axis top and step. */
const axis = computed(() => {
  const raw = max.value / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
  return { step, top: Math.ceil(max.value / step) * step }
})
const plotW = computed(() => width.value - PAD.left - PAD.right)
const plotH = H - PAD.top - PAD.bottom
const band = computed(() => plotW.value / Math.max(1, props.rows.length))
const barW = computed(() => Math.max(6, Math.min(36, band.value * 0.56)))
const y = (v: number) => PAD.top + plotH - (v / axis.value.top) * plotH
const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= axis.value.top + 1e-9; v += axis.value.step) out.push(v)
  return out
})
const labelEvery = computed(() => Math.ceil(30 / band.value))

/** Column with a 4px rounded top, square at the baseline. */
function column(x: number, value: number) {
  const top = y(value)
  const base = y(0)
  const h = base - top
  if (h <= 0) return ''
  const r = Math.min(4, h, barW.value / 2)
  const w = barW.value
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`
}

const hover = ref<number | null>(null)
const tip = computed(() => {
  if (hover.value === null) return null
  const r = props.rows[hover.value]!
  const cx = PAD.left + band.value * (hover.value + 0.5)
  return { r, left: Math.min(Math.max(cx, 100), width.value - 100) }
})
const gstOf = (r: RevenueMonth) => r.cgst + r.sgst + r.igst

/** Short axis labels: ₹0, ₹500, ₹25K, ₹1.5L, ₹2Cr. */
function axisLabel(v: number): string {
  const short = (n: number, unit: string) => `₹${Number(n.toFixed(1))}${unit}`
  if (v >= 10_000_000) return short(v / 10_000_000, 'Cr')
  if (v >= 100_000) return short(v / 100_000, 'L')
  if (v >= 1_000) return short(v / 1_000, 'K')
  return `₹${v}`
}
</script>

<template>
  <div ref="root" class="viz relative w-full" @mouseleave="hover = null">
    <svg
      :width="width"
      :height="H"
      role="img"
      :aria-label="`Money collected per month, ${rows[0]?.month ?? ''} to ${rows.at(-1)?.month ?? ''}. The same numbers are in the table below.`"
    >
      <g>
        <line
          v-for="t in ticks"
          :key="t"
          :x1="PAD.left"
          :x2="width - PAD.right"
          :y1="y(t)"
          :y2="y(t)"
          :stroke="t === 0 ? 'var(--axis)' : 'var(--grid)'"
          stroke-width="1"
        />
        <text
          v-for="t in ticks"
          :key="`l${t}`"
          :x="PAD.left - 8"
          :y="y(t) + 4"
          text-anchor="end"
          class="fill-[var(--muted)] text-[11px] tabular-nums"
        >
          {{ axisLabel(t) }}
        </text>
      </g>
      <g v-for="(r, i) in rows" :key="r.month">
        <rect
          v-if="hover === i"
          :x="PAD.left + band * i"
          :y="PAD.top"
          :width="band"
          :height="plotH"
          fill="var(--hover)"
        />
        <path
          :d="column(PAD.left + band * i + (band - barW) / 2, r.totalAmount)"
          fill="var(--series-1)"
        />
        <text
          v-if="i % labelEvery === 0"
          :x="PAD.left + band * (i + 0.5)"
          :y="H - 10"
          text-anchor="middle"
          class="fill-[var(--muted)] text-[11px]"
        >
          {{ monthFmt.format(asDate(r.month)) }}
        </text>
        <!-- Hit area: the whole month band, bigger than the bar. -->
        <rect
          :x="PAD.left + band * i"
          :y="PAD.top"
          :width="band"
          :height="plotH"
          fill="transparent"
          tabindex="0"
          :aria-label="`${longFmt.format(asDate(r.month))}: ${inr(r.totalAmount)} collected from ${r.count} payment(s)`"
          @mouseenter="hover = i"
          @focus="hover = i"
          @blur="hover = null"
        />
      </g>
    </svg>
    <div
      v-if="tip"
      class="pointer-events-none absolute top-2 z-10 w-48 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-theme-xs shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
      :style="{ left: `${tip.left}px` }"
    >
      <p class="mb-1.5 font-medium text-gray-800 dark:text-white/90">
        {{ longFmt.format(asDate(tip.r.month)) }}
      </p>
      <p class="flex justify-between gap-3 text-gray-600 dark:text-gray-400">
        Collected
        <span class="font-medium text-gray-800 tabular-nums dark:text-white/90">{{
          inr(tip.r.totalAmount)
        }}</span>
      </p>
      <p class="flex justify-between gap-3 text-gray-600 dark:text-gray-400">
        Before GST
        <span class="tabular-nums">{{ inr(tip.r.baseAmount) }}</span>
      </p>
      <p class="flex justify-between gap-3 text-gray-600 dark:text-gray-400">
        GST <span class="tabular-nums">{{ inr(gstOf(tip.r)) }}</span>
      </p>
      <p
        class="mt-1.5 border-t border-gray-100 pt-1.5 text-gray-600 dark:border-gray-800 dark:text-gray-400"
      >
        {{ tip.r.count }} payment(s)
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Reference palette slot 1, validated with the Reports chart in both themes. */
.viz {
  --series-1: #2a78d6;
  --grid: #eceae4;
  --axis: #c9c7c0;
  --muted: #6b6a66;
  --hover: rgba(16, 24, 40, 0.04);
}
.dark .viz {
  --series-1: #3987e5;
  --grid: #2a2a28;
  --axis: #4a4a47;
  --muted: #a3a29b;
  --hover: rgba(255, 255, 255, 0.04);
}
</style>
