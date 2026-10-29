import type { NotesApi } from '@/api'

export interface ViewDeps {
  api: NotesApi | null
  location: Location
  history: History
}

export interface View {
  draw(): void
}
