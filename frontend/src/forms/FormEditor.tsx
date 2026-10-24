import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/auth/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cleanData, FormRenderer, serverFieldErrors, type FormValue } from '@/forms/renderer'
import { queryClient } from '@/lib/api'
import { walk, type TemplateTree } from '@/templates/schema'
import { formsKey, type FormOut } from './api'
import { useUnsavedGuard } from './useUnsavedGuard'

const FORM_ID = 'fiche'

// Key order must not matter: the renderer rebuilds `data` in template order.
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v))

/** Create (no `defaultValue`) or edit a fiche: renderer + save, server errors on the fields, unsaved-changes guard. */
export function FormEditor({
  tree,
  defaultValue,
  save,
  cancelTo,
}: {
  tree: TemplateTree
  defaultValue?: FormValue
  save: (value: FormValue) => Promise<FormOut>
  cancelTo: string
}) {
  const navigate = useNavigate()
  const activeProfileId = useMe().data?.active_profile?.id
  // What the renderer shows before any input: the saved values, or today's date and the active profile on a new fiche.
  const baseline = useMemo<FormValue>(() => {
    if (defaultValue) return defaultValue
    const today = format(new Date(), 'yyyy-MM-dd')
    const prefilled: FormValue['data'] = {}
    for (const node of walk(tree.nodes)) {
      if (node.type === 'date') prefilled[node.id] = today
      else if (node.type === 'author' && activeProfileId) prefilled[node.id] = activeProfileId
    }
    return { reference: null, data: cleanData(tree.nodes, prefilled) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed at mount, like the renderer's defaults
  }, [])
  const [current, setCurrent] = useState(baseline)
  const dirty = canonical(current) !== canonical(baseline)
  const { dialog, allowLeaving } = useUnsavedGuard(dirty)

  const [errors, setErrors] = useState<Record<string, string>>()
  const [general, setGeneral] = useState<string>()
  const mutation = useMutation({
    mutationFn: save,
    onMutate: () => {
      setErrors(undefined)
      setGeneral(undefined)
    },
    onSuccess: (saved) => {
      allowLeaving()
      toast.success(defaultValue ? `Fiche ${saved.reference} enregistrée.` : `Fiche ${saved.reference} créée.`)
      void queryClient.invalidateQueries({ queryKey: formsKey })
      navigate(`/fiches/${saved.id}`)
    },
    onError: (error) => {
      const fields = serverFieldErrors(error)
      if (Object.keys(fields).length) setErrors(fields)
      else setGeneral(error.message)
    },
  })

  return (
    <>
      {general && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertTitle>La fiche n'a pas été enregistrée</AlertTitle>
          <AlertDescription>{general}</AlertDescription>
        </Alert>
      )}
      <FormRenderer id={FORM_ID} tree={tree} defaultValue={defaultValue} errors={errors} onChange={setCurrent} onSubmit={(value) => mutation.mutate(value)}>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="submit" size="lg" disabled={mutation.isPending}>
            {mutation.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Link to={cancelTo} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            Annuler
          </Link>
          {dirty && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Modifications non enregistrées
            </p>
          )}
        </div>
      </FormRenderer>
      {dialog}
    </>
  )
}
