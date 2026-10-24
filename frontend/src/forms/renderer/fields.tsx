import { CalendarIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { AnnexInfo } from '@/annexes/AnnexInfo'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import { FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TemplateNode } from '@/templates/schema'
import { formatDate, nodeLabel, parseIsoDate, toIsoDate, useProfiles } from './helpers'

function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="text-destructive">*</span>
      <span className="sr-only"> (obligatoire)</span>
    </>
  )
}

/** Label text + required mark, then the annex « i » (a link, so outside the <label>). */
export function NodeLabel({ node, htmlFor, id }: { node: TemplateNode; htmlFor?: string; id?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel htmlFor={htmlFor} id={id}>
        <span>
          {nodeLabel(node)}
          {node.required && <RequiredMark />}
        </span>
      </FieldLabel>
      {node.annex_ref && <AnnexInfo annexId={node.annex_ref.annex_id} label={nodeLabel(node)} />}
    </div>
  )
}

/** Inline content for a <legend> or heading: label, required mark, annex. */
export function LabelText({ node }: { node: TemplateNode }) {
  return (
    <>
      <span>
        {nodeLabel(node)}
        {node.required && <RequiredMark />}
      </span>
      {node.annex_ref && <AnnexInfo annexId={node.annex_ref.annex_id} label={nodeLabel(node)} />}
    </>
  )
}

type ControlProps<T> = {
  id: string
  labelId: string
  value: T
  onChange: (value: T) => void
  onBlur: () => void
  invalid: boolean
  required: boolean
  describedBy?: string
}

export function DatePicker({ id, labelId, value, onChange, onBlur, invalid, required, describedBy }: ControlProps<string | undefined>) {
  const [open, setOpen] = useState(false)
  const date = parseIsoDate(value)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onBlur()
      }}
    >
      <PopoverTrigger
        id={id}
        aria-labelledby={`${labelId} ${id}-valeur`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start font-normal tabular-nums sm:w-64')}
      >
        <CalendarIcon data-icon="inline-start" className="text-muted-foreground" />
        <span id={`${id}-valeur`} className={date ? undefined : 'text-muted-foreground'}>
          {date ? formatDate(date) : 'Choisir une date'}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          required={required}
          onSelect={(day: Date | undefined) => {
            onChange(day ? toIsoDate(day) : undefined)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

const NONE = '__aucun__' // Radix Select has no empty value; never sent: the field is just absent

export function AuthorSelect({ id, value, onChange, onBlur, invalid, required, describedBy }: Omit<ControlProps<string | undefined>, 'labelId'>) {
  const loaded = useProfiles().data
  const profiles = loaded ?? []
  const unknown = loaded && value && !profiles.some((p) => p.id === value)
  return (
    <Select
      value={value || (required ? '' : NONE)}
      onValueChange={(next) => onChange(next === NONE ? undefined : next)}
      onOpenChange={(open) => !open && onBlur()}
    >
      <SelectTrigger id={id} className="w-full sm:w-64" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <SelectValue placeholder="Choisir un profil" />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>
          {!required && <SelectItem value={NONE}>Non renseigné</SelectItem>}
          {unknown && <SelectItem value={value}>Profil archivé</SelectItem>}
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.display_name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** Indented block for the children of a selected option (a sub-entry of the register). */
export function OptionChildren({ children }: { children: ReactNode }) {
  return <div className="ml-2 flex flex-col gap-5 border-l-2 border-border py-1 pl-4">{children}</div>
}
