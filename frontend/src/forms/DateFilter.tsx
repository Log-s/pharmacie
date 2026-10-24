import { CalendarIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { fr } from 'date-fns/locale'
import { Button, buttonVariants } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Field, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const shortDay = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

/** A day picked in a shadcn Calendar popover, clearable. */
export function DateFilter({ label, value, onChange, disabled }: { label: string; value?: Date; onChange: (date?: Date) => void; disabled?: React.ComponentProps<typeof Calendar>['disabled'] }) {
  const [open, setOpen] = useState(false)
  return (
    <Field className="w-44">
      <FieldLabel id={`filtre-date-${label}`}>{label}</FieldLabel>
      <div className="flex gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            {/* A native button: shadcn's Button does not forward `ref` under React 18, which Popper needs. */}
            <button type="button" aria-labelledby={`filtre-date-${label}`} className={buttonVariants({ variant: 'outline', className: 'flex-1 justify-start font-normal tabular-nums' })}>
              <CalendarIcon data-icon="inline-start" />
              {value ? shortDay.format(value) : 'Choisir'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              locale={fr}
              selected={value}
              disabled={disabled}
              onSelect={(date) => {
                onChange(date)
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
        {value && (
          <Button type="button" variant="ghost" size="icon" aria-label={`Effacer la date « ${label} »`} onClick={() => onChange(undefined)}>
            <XIcon />
          </Button>
        )}
      </div>
    </Field>
  )
}
