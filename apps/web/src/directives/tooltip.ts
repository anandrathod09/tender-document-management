import type { Directive } from 'vue'

/**
 * `v-tooltip="'Assign'"` shows a small label on hover and keyboard focus.
 *
 * One floating element is shared by the whole app and placed with fixed
 * positioning, so a label is never cut off by a scrolling table or card.
 * The label is visual only: give icon buttons an aria-label as well
 * (IconButton does this for you).
 */

interface TipEl extends HTMLElement {
  _tip?: { text: string; wide: boolean }
  _tipCleanup?: () => void
}

let bubble: HTMLDivElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let owner: TipEl | null = null

function getBubble() {
  if (bubble) return bubble
  bubble = document.createElement('div')
  bubble.setAttribute('role', 'tooltip')
  bubble.className =
    'pointer-events-none fixed z-[100000] rounded-lg bg-gray-900 px-2.5 py-1.5 text-theme-xs font-medium text-white shadow-theme-lg whitespace-pre-line break-words opacity-0 transition-opacity duration-100 dark:bg-gray-700'
  bubble.style.top = '-9999px'
  document.body.appendChild(bubble)
  return bubble
}

function hide() {
  clearTimeout(timer)
  owner = null
  if (bubble) {
    bubble.style.opacity = '0'
    bubble.style.top = '-9999px'
  }
}

function show(el: TipEl) {
  const tip = el._tip
  if (!tip?.text || !el.isConnected) return
  const b = getBubble()
  owner = el
  b.textContent = tip.text
  b.style.maxWidth = tip.wide ? 'min(28rem, calc(100vw - 32px))' : 'min(16rem, calc(100vw - 32px))'
  b.style.left = '0px'
  b.style.top = '0px'

  const r = el.getBoundingClientRect()
  const w = b.offsetWidth
  const h = b.offsetHeight
  const gap = 6
  // Above the element when there is room, otherwise below.
  const top = r.top - h - gap >= 8 ? r.top - h - gap : r.bottom + gap
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
  b.style.top = `${Math.round(top)}px`
  b.style.left = `${Math.round(left)}px`
  b.style.opacity = '1'
}

function read(value: unknown, wide: boolean) {
  return { text: typeof value === 'string' ? value.trim() : '', wide }
}

export const vTooltip: Directive<TipEl, string | null | undefined> = {
  mounted(el, binding) {
    el._tip = read(binding.value, !!binding.modifiers.wide)
    const enter = () => {
      clearTimeout(timer)
      timer = setTimeout(() => show(el), binding.modifiers.wide ? 300 : 120)
    }
    const leave = () => {
      if (owner === el || !owner) hide()
    }
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    el.addEventListener('focusin', enter)
    el.addEventListener('focusout', leave)
    el.addEventListener('click', leave)
    el._tipCleanup = () => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('mouseleave', leave)
      el.removeEventListener('focusin', enter)
      el.removeEventListener('focusout', leave)
      el.removeEventListener('click', leave)
    }
  },
  updated(el, binding) {
    el._tip = read(binding.value, !!binding.modifiers.wide)
    if (owner === el) {
      if (el._tip.text) show(el)
      else hide()
    }
  },
  beforeUnmount(el) {
    el._tipCleanup?.()
    if (owner === el) hide()
  },
}

// A scrolled page or table would leave the label floating in the wrong place.
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide()
  })
}
