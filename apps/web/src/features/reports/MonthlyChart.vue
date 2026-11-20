<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MonthlyRow } from '@tdm/shared'
import { formatINR } from '@/utils/tenders'

/**
 * Bids submitted, won and lost per month as grouped columns on one count
 * axis. Won value is a different measure, so it is in the tooltip and the
 * table below, never on a second axis.
 */
const props = defineProps<{ rows: MonthlyRow[] }>()

const SERIES = [
  { key: 'submitted', label: 'Submitted', color: 'var(--series-1)' },
  { key: 'won', label: 'Won', color: 'var(--series-2)' },
  { key: 'lost', label: 'Lost', color: 'var(--series-3)' },
] as const

const H = 260
const PAD = { top: 12, right: 12, bottom: 28, left: 36 }
const root = ref<HTMLElement | null>(null)
const width = ref(640)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(
    ([e]) => (width.value = Math.max(320, Math.floor(e!.contentRect.width))),
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
const monthLabel = (m: string) => monthFmt.format(new Date(`${m}-01T00:00:00Z`))
const yearOf = (m: string) => m.slice(0, 4)

const max = computed(() => Math.max(1, ...props.rows.flatMap((r) => [r.submitted, r.won, r.lost])))
/** A "nice" axis top and step for whole-number counts. */
const axis = computed(() => {
  const raw = max.value / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow)
  return { step, top: Math.ceil(max.value / step) * step }
})
const plotW = computed(() => width.value - PAD.left - PAD.right)
const plotH = H - PAD.top - PAD.bottom
const band = computed(() => plotW.value / Math.max(1, props.rows.length))
const GAP = 2
const barW = computed(() => Math.max(3, Math.min(24, (band.value * 0.72 - GAP * 2) / 3)))
const y = (v: number) => PAD.top + plotH - (v / axis.value.top) * plotH
const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= axis.value.top; v += axis.value.step) out.push(v)
  return out
})
// Label every month when there is room, otherwise every few months.
const labelEvery = computed(() => Math.ceil(36 / band.value))

/** Column path: 4px rounded data end, square at the baseline. */
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
  return { r, left: Math.min(Math.max(cx, 90), width.value - 90) }
})
</script>

<template>
  <div class="viz relative">
    <ul
      class="mb-3 flex flex-wrap gap-4 text-theme-xs text-gray-600 dark:text-gray-400"
      aria-label="Legend"
    >
      <li v-for="s in SERIES" :key="s.key" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm" :style="{ background: s.color }" aria-hidden="true" />{{
          s.label
        }}
      </li>
    </ul>
    <div ref="root" class="relative w-full" @mouseleave="hover = null">
      <svg
        :width="width"
        :height="H"
        role="img"
        :aria-label="`Bids submitted, won and lost per month, ${rows[0]?.month ?? ''} to ${rows.at(-1)?.month ?? ''}. The same numbers are in the table below.`"
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
            {{ t }}
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
            v-for="(s, si) in SERIES"
            :key="s.key"
            :d="
              column(
                PAD.left + band * i + (band - (barW * 3 + GAP * 2)) / 2 + si * (barW + GAP),
                r[s.key],
              )
            "
            :fill="s.color"
          />
          <text
            v-if="i % labelEvery === 0"
            :x="PAD.left + band * (i + 0.5)"
            :y="H - 10"
            text-anchor="middle"
            class="fill-[var(--muted)] text-[11px]"
          >
            {{ monthLabel(r.month) }}
            <template v-if="i === 0 || r.month.endsWith('-01')">
              {{ yearOf(r.month).slice(2) }}
            </template>
          </text>
          <!-- Hit area: the whole month band, taller and wider than the bars. -->
          <rect
            :x="PAD.left + band * i"
            :y="PAD.top"
            :width="band"
            :height="plotH"
            fill="transparent"
            tabindex="0"
            :aria-label="`${longFmt.format(new Date(`${r.month}-01T00:00:00Z`))}: ${r.submitted} submitted, ${r.won} won, ${r.lost} lost`"
            @mouseenter="hover = i"
            @focus="hover = i"
            @blur="hover = null"
          />
        </g>
      </svg>
      <div
        v-if="tip"
        class="pointer-events-none absolute top-2 z-10 w-44 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-theme-xs shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
        :style="{ left: `${tip.left}px` }"
      >
        <p class="mb-1.5 font-medium text-gray-800 dark:text-white/90">
          {{ longFmt.format(new Date(`${tip.r.month}-01T00:00:00Z`)) }}
        </p>
        <p
          v-for="s in SERIES"
          :key="s.key"
          class="flex items-center justify-between gap-3 text-gray-600 dark:text-gray-400"
        >
          <span class="flex items-center gap-1.5"
            ><span class="size-2 rounded-sm" :style="{ background: s.color }" />{{ s.label }}</span
          >
          <span class="font-medium text-gray-800 tabular-nums dark:text-white/90">{{
            tip.r[s.key]
          }}</span>
        </p>
        <p
          class="mt-1.5 border-t border-gray-100 pt-1.5 text-gray-600 dark:border-gray-800 dark:text-gray-400"
        >
          Won value
          <span class="float-right font-medium text-gray-800 dark:text-white/90">{{
            formatINR(tip.r.wonValue)
          }}</span>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Reference palette, slots 1–3, validated as a set in both themes. */
.viz {
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --grid: #eceae4;
  --axis: #c9c7c0;
  --muted: #6b6a66;
  --hover: rgba(16, 24, 40, 0.04);
}
:global(.dark) .viz {
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
  --grid: #2a2a28;
  --axis: #4a4a47;
  --muted: #a3a29b;
  --hover: rgba(255, 255, 255, 0.04);
}
</style>
