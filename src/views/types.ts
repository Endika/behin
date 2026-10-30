import type { NotesApi } from '@/api'

export interface ViewDeps {
  api: NotesApi
  location: Location
  history: History
}

export interface View {
  draw(): void
  dispose(): void
}
