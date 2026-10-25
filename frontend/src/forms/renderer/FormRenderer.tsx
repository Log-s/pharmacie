import { useQuery } from '@tanstack/react-query'
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, type FieldErrors, type Resolver, useForm, type UseFormReturn } from 'react-hook-form'
import { useMe } from '@/auth/session'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { isValidReference, REFERENCE_EXAMPLE, REFERENCE_HINT } from '@/config/reference'
import { api } from '@/lib/api'
import { isGroup, walk, type GroupNode, type TemplateNode, type TemplateTree } from '@/templates/schema'
import { AuthorSelect, DatePicker, LabelText, NodeLabel, OptionChildren } from './fields'
import { fieldId, nodeLabel, toIsoDate } from './helpers'
import { ReadonlyView } from './ReadonlyView'
import { applySelection, cleanData, type FieldValue, type FormData, isSelected, validateData, visibleNodes } from './visibility'

/** What the API takes (U7 `POST/PUT /api/forms`): `reference` null = let the server number it. */
export type FormValue = { reference: string | null; data: Record<string, FieldValue> }

export type FormRendererProps = {
  /** The template version's tree (`schema_json`). */
  tree: TemplateTree
  /** `readonly` renders the values as text, without inputs. */
  mode?: 'edit' | 'readonly'
  /** An existing form's values. Absent = new form: date = today, author = active profile, reference = next one. */
  defaultValue?: FormValue
  /** Called with the cleaned value (visible fields only, no empty value) once client validation passes. */
  onSubmit?: (value: FormValue) => unknown
  /** Called on every change with the cleaned value. */
  onChange?: (value: FormValue) => void
  /** Server errors by node id, plus `reference` (see `serverFieldErrors`). Shown on the fields. */
  errors?: Record<string, string>
  /** `id` of the <form>: a submit button elsewhere uses `form={id}`. */
  id?: string
  /** Heading level of top-level categories (default 2). */
  headingLevel?: number
  /** Rendered at the end of the form (actions). */
  children?: ReactNode
}

/** Renders a template tree as a fillable form (react-hook-form) or, with `mode="readonly"`, as text. */
export function FormRenderer(props: FormRendererProps) {
  if (props.mode === 'readonly') return <ReadonlyView tree={props.tree} value={props.defaultValue} headingLevel={props.headingLevel ?? 2} />
  return <EditForm {...props} />
}

type Values = { reference: string; data: FormData }
type Ctx = {
  form: UseFormReturn<Values>
  isNew: boolean
  activeProfileId?: string
  today: string
  changeGroup: (group: GroupNode, next: FieldValue | undefined) => void
}
const RendererContext = createContext<Ctx | null>(null)
const useRenderer = () => useContext(RendererContext)!

const referenceNode = (nodes: TemplateNode[], data: FormData) => visibleNodes(nodes, data).find((n) => n.type === 'reference')

type Latest = { tree: TemplateTree; prefilled: string; isNew: boolean; defaultReference: string | null }

function toValue(values: Values, { tree, prefilled, isNew, defaultReference }: Latest): FormValue {
  const data = cleanData(tree.nodes, values.data ?? {})
  if (!referenceNode(tree.nodes, values.data ?? {})) return { reference: isNew ? null : defaultReference, data }
  const reference = (values.reference ?? '').trim()
  // An untouched proposal goes back as null: a user-chosen reference does not advance the counter (U7).
  return { reference: isNew && (reference === '' || reference === prefilled) ? null : reference, data }
}

function focusFirst(tree: TemplateTree, data: FormData | undefined, keys: string[]) {
  const first = visibleNodes(tree.nodes, data ?? {}).find((n) => keys.includes(n.id) || (n.type === 'reference' && keys.includes('reference')))
  if (first) document.getElementById(fieldId(first.id))?.focus() // shadcn inputs take no ref under React 18
}

function EditForm({ tree, defaultValue, onSubmit, onChange, errors, id, headingLevel = 2, children }: FormRendererProps) {
  const isNew = !defaultValue
  const activeProfileId = useMe().data?.active_profile?.id
  const [today] = useState(() => toIsoDate(new Date()))
  const hasReference = useMemo(() => [...walk(tree.nodes)].some((n) => n.type === 'reference'), [tree])
  const next = useQuery({
    queryKey: ['forms', 'next-reference'],
    queryFn: () => api<{ reference: string }>('/forms/next-reference'),
    enabled: isNew && hasReference,
    staleTime: 0,
  })
  // The resolver and the value builder read the latest tree (the editor preview changes it live).
  const latest = useRef<Latest>({ tree, prefilled: '', isNew, defaultReference: defaultValue?.reference ?? null })
  useEffect(() => {
    latest.current.tree = tree
  }, [tree])

  const resolver: Resolver<Values> = (values) => {
    const found: FieldErrors<Values> = {}
    const byNode = validateData(latest.current.tree.nodes, values.data ?? {})
    if (Object.keys(byNode).length)
      found.data = Object.fromEntries(Object.entries(byNode).map(([key, message]) => [key, { type: 'validate', message }])) as FieldErrors<Values>['data']
    if (referenceNode(latest.current.tree.nodes, values.data ?? {})) {
      const reference = (values.reference ?? '').trim()
      const message =
        reference === ''
          ? isNew ? undefined : 'La référence est obligatoire.'
          : isValidReference(reference) ? undefined : `Format attendu\u00a0: ${REFERENCE_HINT} (par exemple ${REFERENCE_EXAMPLE}).`
      if (message) found.reference = { type: 'validate', message }
    }
    return Object.keys(found).length ? { values: {}, errors: found } : { values, errors: {} }
  }

  const form = useForm<Values>({
    mode: 'onTouched',
    defaultValues: { reference: defaultValue?.reference ?? '', data: defaultValue?.data ?? {} },
    resolver,
  })

  useEffect(() => {
    const proposal = next.data?.reference
    if (proposal && !form.getValues('reference')) {
      latest.current.prefilled = proposal
      form.setValue('reference', proposal)
    }
  }, [next.data, form])

  useEffect(() => {
    if (!errors) return
    for (const [key, message] of Object.entries(errors))
      form.setError(key === 'reference' ? 'reference' : `data.${key}`, { type: 'server', message })
    focusFirst(latest.current.tree, form.getValues('data'), Object.keys(errors))
  }, [errors, form])

  useEffect(() => {
    if (!onChange) return
    return form.subscribe({ formState: { values: true }, callback: ({ values }) => onChange(toValue(values, latest.current)) })
  }, [form, onChange])

  const [pending, setPending] = useState<{ group: GroupNode; next: FieldValue | undefined; data: FormData; cleared: TemplateNode[] } | null>(null)
  const commit = (group: GroupNode, value: FieldValue | undefined, data: FormData) => {
    for (const key of Object.keys(form.getValues('data') ?? {})) if (!(key in data)) form.setValue(`data.${key}`, undefined)
    form.setValue(`data.${group.id}`, value, { shouldDirty: true, shouldTouch: true, shouldValidate: true })
  }
  const changeGroup = (group: GroupNode, value: FieldValue | undefined) => {
    const result = applySelection(group, value, form.getValues('data') ?? {})
    if (result.cleared.length) setPending({ group, next: value, ...result })
    else commit(group, value, result.data)
  }

  const submit = (event: FormEvent) =>
    form.handleSubmit(
      (values) => onSubmit?.(toValue(values, latest.current)),
      (found) => focusFirst(latest.current.tree, form.getValues('data'), [...Object.keys(found.data ?? {}), ...(found.reference ? ['reference'] : [])]),
    )(event)

  return (
    <RendererContext.Provider value={{ form, isNew, activeProfileId, today, changeGroup }}>
      <form id={id} onSubmit={submit} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          {tree.nodes.map((node) => (
            <NodeField key={node.id} node={node} level={headingLevel} />
          ))}
        </FieldGroup>
        {children}
      </form>
      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Effacer les champs masqués&nbsp;?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce choix masque {pending?.cleared.length === 1 ? 'un champ déjà rempli' : 'des champs déjà remplis'}&nbsp;:{' '}
              {pending?.cleared.map((n) => `« ${nodeLabel(n)} »`).join(', ')}. {pending?.cleared.length === 1 ? 'Sa valeur sera effacée' : 'Leurs valeurs seront effacées'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder mon choix précédent</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => pending && commit(pending.group, pending.next, pending.data)}>
              Effacer et continuer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RendererContext.Provider>
  )
}

function Heading({ level, id, children }: { level: number; id: string; children: ReactNode }) {
  const Tag = `h${Math.min(level, 6)}` as 'h2'
  return (
    <Tag id={id} className="flex items-center gap-1.5 text-base font-semibold text-balance">
      {children}
    </Tag>
  )
}

function NodeField({ node, level }: { node: TemplateNode; level: number }) {
  if (node.type === 'category')
    return (
      <section aria-labelledby={`${fieldId(node.id)}-titre`} className="flex flex-col gap-4 border-t pt-4 first:border-t-0 first:pt-0">
        <div className="flex flex-col gap-1">
          <Heading level={level} id={`${fieldId(node.id)}-titre`}>
            <LabelText node={node} />
          </Heading>
          {node.help && <p className="text-sm text-pretty text-muted-foreground">{node.help}</p>}
        </div>
        <FieldGroup>
          {node.children.map((child) => (
            <NodeField key={child.id} node={child} level={level + 1} />
          ))}
        </FieldGroup>
      </section>
    )
  if (isGroup(node)) return <GroupField node={node} level={level} />
  return <ValueField node={node} />
}

function GroupField({ node, level }: { node: GroupNode; level: number }) {
  const { form, changeGroup } = useRenderer()
  const name = `data.${node.id}` as const
  const helpId = `${fieldId(node.id)}-aide`
  const errorId = `${fieldId(node.id)}-erreur`
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        const data = { [node.id]: field.value }
        const invalid = !!fieldState.error
        const describedBy = [node.help && helpId, invalid && errorId].filter(Boolean).join(' ') || undefined
        const childrenOf = (index: number) =>
          isSelected(node, node.options[index], data) &&
          node.options[index].children.length > 0 && (
            <OptionChildren>
              {node.options[index].children.map((child) => (
                <NodeField key={child.id} node={child} level={level + 1} />
              ))}
            </OptionChildren>
          )
        return (
          <FieldSet data-invalid={invalid || undefined} aria-describedby={describedBy}>
            <FieldLegend variant="label" className="flex items-center gap-1.5">
              <LabelText node={node} />
            </FieldLegend>
            {node.help && <FieldDescription id={helpId}>{node.help}</FieldDescription>}
            {node.type === 'checkbox_group' ? (
              <div className="flex flex-col gap-3" data-slot="checkbox-group">
                {node.options.map((option, index) => {
                  const checked = isSelected(node, option, data)
                  const values = Array.isArray(field.value) ? field.value : []
                  return (
                    <div key={option.id} className="flex flex-col gap-3">
                      <Field orientation="horizontal" data-invalid={invalid || undefined}>
                        <Checkbox
                          id={index === 0 ? fieldId(node.id) : `${fieldId(node.id)}-${option.id}`}
                          checked={checked}
                          aria-invalid={invalid || undefined}
                          onBlur={field.onBlur}
                          onCheckedChange={(on) => {
                            const picked = on === true ? [...values, option.id] : values.filter((v) => v !== option.id)
                            changeGroup(node, node.options.map((o) => o.id).filter((oid) => picked.includes(oid)))
                          }}
                        />
                        <FieldLabel htmlFor={index === 0 ? fieldId(node.id) : `${fieldId(node.id)}-${option.id}`} className="font-normal">
                          {nodeLabel(option)}
                        </FieldLabel>
                      </Field>
                      {childrenOf(index)}
                    </div>
                  )
                })}
              </div>
            ) : (
              <RadioGroup
                value={typeof field.value === 'string' ? field.value : ''}
                onValueChange={(value) => changeGroup(node, value)}
                aria-invalid={invalid || undefined}
                className="gap-3"
              >
                {node.options.map((option, index) => (
                  <div key={option.id} className="flex flex-col gap-3">
                    <Field orientation="horizontal" data-invalid={invalid || undefined}>
                      <RadioGroupItem
                        value={option.id}
                        id={index === 0 ? fieldId(node.id) : `${fieldId(node.id)}-${option.id}`}
                        aria-invalid={invalid || undefined}
                        onBlur={field.onBlur}
                      />
                      <FieldLabel htmlFor={index === 0 ? fieldId(node.id) : `${fieldId(node.id)}-${option.id}`} className="font-normal">
                        {nodeLabel(option)}
                      </FieldLabel>
                    </Field>
                    {childrenOf(index)}
                  </div>
                ))}
              </RadioGroup>
            )}
            {node.type === 'radio_group' && !node.required && typeof field.value === 'string' && field.value && (
              <Button type="button" variant="ghost" size="xs" className="w-fit" onClick={() => changeGroup(node, undefined)}>
                Effacer le choix
              </Button>
            )}
            <FieldError id={errorId}>{fieldState.error?.message}</FieldError>
          </FieldSet>
        )
      }}
    />
  )
}

function ValueField({ node }: { node: TemplateNode }) {
  const { form, isNew, activeProfileId, today } = useRenderer()
  const id = fieldId(node.id)
  const labelId = `${id}-libelle`
  const helpId = `${id}-aide`
  const errorId = `${id}-erreur`
  const counterId = `${id}-compteur`
  const prefill = !isNew ? undefined : node.type === 'date' ? today : node.type === 'author' ? activeProfileId : undefined
  const help = node.type === 'reference' && !node.help ? `Proposée automatiquement, modifiable. Format\u00a0: ${REFERENCE_HINT}.` : node.help

  return (
    <Controller
      control={form.control}
      name={node.type === 'reference' ? 'reference' : `data.${node.id}`}
      defaultValue={prefill}
      render={({ field, fieldState }) => {
        const invalid = !!fieldState.error
        const value = typeof field.value === 'string' ? field.value : ''
        const maxLength = node.type === 'text' ? node.max_length : null
        const describedBy = [help && helpId, maxLength && counterId, invalid && errorId].filter(Boolean).join(' ') || undefined
        const common = { id, invalid, required: node.required, describedBy, onBlur: field.onBlur }
        let control: ReactNode
        if (node.type === 'date') control = <DatePicker {...common} labelId={labelId} value={value} onChange={field.onChange} />
        else if (node.type === 'author') control = <AuthorSelect {...common} value={value} onChange={field.onChange} />
        else {
          const Control = node.type === 'text' && node.multiline ? Textarea : Input
          control = (
            <Control
              id={id}
              name={field.name}
              value={value}
              onChange={(event) => field.onChange(event.target.value)}
              onBlur={field.onBlur}
              maxLength={maxLength ?? undefined}
              autoComplete="off"
              spellCheck={node.type === 'reference' ? false : undefined}
              placeholder={node.type === 'reference' ? (isNew ? 'Numérotée automatiquement' : REFERENCE_HINT) : undefined}
              className={node.type === 'reference' ? 'tabular-nums sm:w-64' : undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )
        }
        return (
          <Field data-invalid={invalid || undefined}>
            <NodeLabel node={node} htmlFor={id} id={labelId} />
            {control}
            {(help || maxLength) && (
              <div className="flex items-start justify-between gap-4">
                {help ? <FieldDescription id={helpId}>{help}</FieldDescription> : <span />}
                {maxLength && (
                  <FieldDescription id={counterId} className="shrink-0 tabular-nums">
                    {value.length} / {maxLength}
                  </FieldDescription>
                )}
              </div>
            )}
            <FieldError id={errorId}>{fieldState.error?.message}</FieldError>
          </Field>
        )
      }}
    />
  )
}
