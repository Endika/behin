import './style.css'
import { createHttpApi } from '@/api'
import { mountApp } from '@/app'

function safeStorage(): Storage {
  try {
    return localStorage
  } catch {
    const memory = new Map<string, string>()
    return {
      getItem: (name) => memory.get(name) ?? null,
      setItem: (name, value) => void memory.set(name, value),
    } as Storage
  }
}

const root = document.getElementById('app')
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (root) {
  mountApp(root, {
    api: url && key ? createHttpApi(url, key) : null,
    location,
    history,
    storage: safeStorage(),
  })
}
