import { ref } from 'vue'

const isDark = ref(document.documentElement.classList.contains('dark'))

/** Light/dark theme, remembered per browser. */
export function useTheme() {
  function toggle() {
    isDark.value = !isDark.value
    document.documentElement.classList.toggle('dark', isDark.value)
    try {
      localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
    } catch {
      // Storage blocked (private mode): the theme still applies for this visit.
    }
  }
  return { isDark, toggle }
}
