import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { fieldErrors, focusFirstInvalid, hasUnstorable, plural, UNSTORABLE_MESSAGE } from '@/admin/validation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { api, ApiError, queryClient } from '@/lib/api'
import { type Folder, type NoteItem, type Tree, type TreeIndex, annexesKey, annexRequest, pathLabel } from '@/annexes/api'

/** What a move or delete dialog acts on. */
export type Target = { kind: 'folder'; folder: Folder } | { kind: 'note'; note: NoteItem }

const targetUrl = (target: Target) => (target.kind === 'folder' ? `/annex-folders/${target.folder.id}` : `/annexes/${target.note.id}`)
const targetName = (target: Target) => (target.kind === 'folder' ? target.folder.name : target.note.title)
const ROOT = 'root' // Radix Select refuses an empty value

const nameSchema = z.string().trim().min(1, 'Le nom est obligatoire.').max(200, 'Le nom ne peut pas dépasser 200 caractères.')

/** Admin: create a folder under `parentId` (no `folder`) or rename `folder`. */
export function FolderDialog({ folder, parentId, onClose }: { folder?: Folder; parentId: string | null; onClose: () => void }) {
  const [name, setName] = useState(folder?.name ?? '')
  const [error, setError] = useState<string>()
  const save = useMutation({
    mutationFn: (value: string) =>
      folder
        ? api<Folder>(`/annex-folders/${folder.id}`, { method: 'PATCH', json: { name: value } })
        : api<Folder>('/annex-folders', { method: 'POST', json: { name: value, parent_id: parentId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: annexesKey })
      toast.success(folder ? 'Dossier renommé.' : 'Dossier créé.')
      onClose()
    },
    onError: (e) => {
      const fields = fieldErrors(e)
      if (fields.name) {
        setError(fields.name)
        focusFirstInvalid(fields, { name: 'annex-folder-name' })
      } else toast.error(e.message)
    },
  })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = nameSchema.safeParse(name)
    const found = !parsed.success ? parsed.error.issues[0].message : hasUnstorable(name) ? UNSTORABLE_MESSAGE : undefined
    setError(found)
    focusFirstInvalid(found ? { name: found } : {}, { name: 'annex-folder-name' })
    if (parsed.success && !found) save.mutate(parsed.data)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{folder ? 'Renommer le dossier' : 'Nouveau dossier'}</DialogTitle>
            <DialogDescription>{folder ? `Nouveau nom de « ${folder.name} ».` : 'Le dossier est créé dans le dossier affiché.'}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="annex-folder-name">Nom</FieldLabel>
              <Input id="annex-folder-name" name="name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'annex-folder-name-error' : undefined} />
              {error && <FieldError id="annex-folder-name-error">{error}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner data-icon="inline-start" />}
              {folder ? 'Renommer' : 'Créer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin: move a note or a folder; a folder cannot go into itself or one of its descendants. */
export function MoveDialog({ target, index, onClose }: { target: Target; index: TreeIndex; onClose: () => void }) {
  const current = (target.kind === 'folder' ? target.folder.parent_id : target.note.folder_id) ?? ROOT
  const [destination, setDestination] = useState(current)
  const excluded = target.kind === 'folder' ? new Set([target.folder.id, ...index.descendants(target.folder.id)]) : new Set<string>()
  const options = [...index.byId.values()]
    .filter((folder) => !excluded.has(folder.id))
    .map((folder) => ({ id: folder.id, label: pathLabel(index, folder.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  const move = useMutation({
    mutationFn: () => {
      const id = destination === ROOT ? null : destination
      return api(targetUrl(target), { method: 'PATCH', json: target.kind === 'folder' ? { parent_id: id } : { folder_id: id } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: annexesKey })
      toast.success(target.kind === 'folder' ? 'Dossier déplacé.' : 'Note déplacée.')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            move.mutate()
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{target.kind === 'folder' ? 'Déplacer le dossier' : 'Déplacer la note'}</DialogTitle>
            <DialogDescription>Choisissez le dossier de destination de « {targetName(target)} ».</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="annex-move-destination">Destination</FieldLabel>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger id="annex-move-destination" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ROOT}>Racine (Annexes)</SelectItem>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={move.isPending || destination === current}>
              {move.isPending && <Spinner data-icon="inline-start" />}
              Déplacer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin: the server refuses (409) while a template's latest version references a deleted note. */
export function DeleteDialog({ target, tree, index, onClose, onDeleted }: { target: Target; tree: Tree; index: TreeIndex; onClose: () => void; onDeleted?: () => void }) {
  let impact = 'Cette action est irréversible.'
  if (target.kind === 'folder') {
    const below = index.descendants(target.folder.id)
    const notes = tree.notes.filter((note) => note.folder_id === target.folder.id || (note.folder_id && below.has(note.folder_id))).length
    const parts = [notes && plural(notes, 'note'), below.size && plural(below.size, 'sous-dossier')].filter(Boolean)
    impact = `${parts.length ? `Seront aussi supprimés : ${parts.join(' et ')}. ` : 'Ce dossier est vide. '}Cette action est irréversible.`
  }
  const remove = useMutation({
    mutationFn: () => annexRequest(targetUrl(target)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: annexesKey })
      toast.success(target.kind === 'folder' ? 'Dossier supprimé.' : 'Note supprimée.')
      onClose()
      onDeleted?.()
    },
    onError: (error) => {
      if (!(error instanceof ApiError && error.status === 409)) {
        toast.error(error.message)
        onClose()
      }
    },
  })
  const conflict = remove.error instanceof ApiError && remove.error.status === 409 ? remove.error : null
  const templates = (conflict?.detail as { templates?: string[] } | undefined)?.templates ?? []

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{target.kind === 'folder' ? `Supprimer le dossier « ${targetName(target)} » ?` : `Supprimer la note « ${targetName(target)} » ?`}</AlertDialogTitle>
          <AlertDialogDescription>{impact}</AlertDialogDescription>
        </AlertDialogHeader>
        {conflict && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              <p>{conflict.message}</p>
              {templates.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {templates.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{conflict ? 'Fermer' : 'Annuler'}</AlertDialogCancel>
          {!conflict && (
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault()
                remove.mutate()
              }}
            >
              Supprimer
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
