import { useMutation } from '@tanstack/react-query'
import { UploadIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { hasUnstorable, UNSTORABLE_MESSAGE } from '@/admin/validation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { queryClient } from '@/lib/api'
import { type Annex, annexesKey, annexRequest, formatSize, MAX_ANNEX_BYTES } from '@/annexes/api'
import { cn } from 'cn'

/** Client-side check that mirrors the server rules, so the common mistakes fail before the upload. */
function problem(file: File, title: string): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) return `« ${file.name} » n'est pas un PDF : seuls les fichiers .pdf sont acceptés.`
  if (file.size > MAX_ANNEX_BYTES)
    return `« ${file.name} » est trop volumineux (${formatSize(file.size)}) : la taille maximale est de ${formatSize(MAX_ANNEX_BYTES)}.`
  if (hasUnstorable(title)) return UNSTORABLE_MESSAGE
  return null
}

/** Admin: drag-and-drop zone and file input; the optional title defaults to the file name. */
export function AnnexUpload() {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('file', file)
      if (title.trim()) body.append('title', title.trim()) // never send "" for an optional field
      return annexRequest<Annex>('/annexes', 'POST', body)
    },
    onSuccess: async (annex) => {
      setTitle('')
      await queryClient.invalidateQueries({ queryKey: annexesKey })
      toast.success(`Annexe « ${annex.title} » ajoutée.`)
    },
    onError: (e) => setError(e.message),
  })

  const submit = (file: File | undefined) => {
    if (!file) return
    const found = problem(file, title)
    setError(found)
    if (!found) upload.mutate(file)
  }

  return (
    <section aria-labelledby="upload-title" className="mb-6 flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 id="upload-title" className="text-lg font-semibold">
        Ajouter une annexe
      </h2>
      <Field>
        <FieldLabel htmlFor="annex-title">Titre (facultatif)</FieldLabel>
        <Input id="annex-title" name="title" autoComplete="off" className="max-w-md" placeholder="Par défaut, le nom du fichier…" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          submit(e.dataTransfer.files[0])
        }}
        className={cn('flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors', dragging && 'border-primary bg-accent')}
      >
        <UploadIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Glissez un fichier PDF ici (20 Mo au plus), ou</p>
        <input
          ref={input}
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-label="Fichier PDF"
          onChange={(e) => {
            submit(e.target.files?.[0])
            e.target.value = '' // allows choosing the same file again after fixing the title
          }}
        />
        <Button type="button" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
          {upload.isPending ? 'Envoi en cours…' : 'Choisir un fichier'}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
