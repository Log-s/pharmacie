import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { fieldErrors, hasUnstorable, UNSTORABLE_MESSAGE } from '@/admin/validation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, queryClient } from '@/lib/api'
import { type Annex, annexesKey, annexRequest } from '@/annexes/api'

const schema = z.object({
  title: z.string().trim().min(1, 'Le titre est obligatoire.').max(200, 'Le titre ne peut pas dépasser 200 caractères.'),
  excerpt: z.string().max(2000, "L'extrait ne peut pas dépasser 2 000 caractères."),
})

type Errors = Partial<Record<'title' | 'excerpt', string>>

/** Admin: edit the title and the excerpt shown by the AnnexInfo tooltip. */
export function EditAnnexDialog({ annex, onClose }: { annex: Annex; onClose: () => void }) {
  const [values, setValues] = useState({ title: annex.title, excerpt: annex.excerpt })
  const [errors, setErrors] = useState<Errors>({})
  const save = useMutation({
    mutationFn: (body: typeof values) => api<Annex>(`/annexes/${annex.id}`, { method: 'PATCH', json: body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: annexesKey })
      toast.success('Annexe modifiée.')
      onClose()
    },
    onError: (error) => {
      const fields = fieldErrors(error)
      if (Object.keys(fields).length) setErrors(fields)
      else toast.error(error.message)
    },
  })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = schema.safeParse(values)
    const found: Errors = {}
    if (!parsed.success) for (const issue of parsed.error.issues) found[issue.path[0] as keyof Errors] ??= issue.message
    for (const key of ['title', 'excerpt'] as const) if (hasUnstorable(values[key])) found[key] = UNSTORABLE_MESSAGE
    setErrors(found)
    if (parsed.success && !Object.keys(found).length) save.mutate(parsed.data)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Modifier l'annexe</DialogTitle>
            <DialogDescription>Fichier : {annex.filename}. Le fichier lui-même ne peut pas être remplacé.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.title}>
              <FieldLabel htmlFor="annex-edit-title">Titre</FieldLabel>
              <Input id="annex-edit-title" name="title" autoComplete="off" value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'annex-edit-title-error' : undefined} />
              {errors.title && <FieldError id="annex-edit-title-error">{errors.title}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.excerpt}>
              <FieldLabel htmlFor="annex-edit-excerpt">Extrait</FieldLabel>
              <Textarea id="annex-edit-excerpt" name="excerpt" rows={6} value={values.excerpt} onChange={(e) => setValues({ ...values, excerpt: e.target.value })} aria-invalid={!!errors.excerpt} aria-describedby={errors.excerpt ? 'annex-edit-excerpt-error' : 'annex-edit-excerpt-help'} />
              <FieldDescription id="annex-edit-excerpt-help">Affiché au survol de l'icône « i » dans les fiches.</FieldDescription>
              {errors.excerpt && <FieldError id="annex-edit-excerpt-error">{errors.excerpt}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner data-icon="inline-start" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin: the server refuses (409) while a template's latest version references the annex. */
export function DeleteAnnexDialog({ annex, onClose }: { annex: Annex; onClose: () => void }) {
  const remove = useMutation({
    mutationFn: () => annexRequest<void>(`/annexes/${annex.id}`, 'DELETE'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: annexesKey })
      toast.success('Annexe supprimée.')
      onClose()
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
          <AlertDialogTitle>Supprimer l'annexe « {annex.title} » ?</AlertDialogTitle>
          <AlertDialogDescription>Le fichier PDF sera supprimé définitivement. Cette action est irréversible.</AlertDialogDescription>
        </AlertDialogHeader>
        {conflict && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Suppression impossible</AlertTitle>
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
              Supprimer l'annexe
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
