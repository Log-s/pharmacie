import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { fieldErrors, hasUnstorable, UNSTORABLE_MESSAGE } from '@/admin/validation'
import { Paraphe } from '@/components/ProfileSwitcher'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { api, queryClient } from '@/lib/api'
import { type Profile, type ProfileInput, profilesKey } from '@/profiles/api'

// Palette of the register: distinct hues, each readable behind the initials (text stays foreground).
const PRESETS = ['#2f855a', '#2b6cb0', '#6b46c1', '#b83280', '#c05621', '#b7791f', '#0f766e', '#4a5568']

const schema = z.object({
  display_name: z.string().trim().min(1, 'Le nom affiché est obligatoire.').max(100, 'Le nom ne peut pas dépasser 100 caractères.'),
  initials: z.string().trim().min(1, 'Les initiales sont obligatoires.').max(3, 'Les initiales comptent 3 caractères au plus.'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choisissez une couleur.'),
})

type Errors = Partial<Record<keyof ProfileInput, string>>

/** Create (no `profile`) or edit one profile; closes itself once saved. */
export function ProfileFormDialog({ profile, open, onOpenChange }: { profile?: Profile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [values, setValues] = useState<ProfileInput>({
    display_name: profile?.display_name ?? '',
    initials: profile?.initials ?? '',
    color: profile?.color ?? PRESETS[0],
  })
  const [errors, setErrors] = useState<Errors>({})
  const save = useMutation({
    mutationFn: (body: ProfileInput) =>
      profile ? api<Profile>(`/profiles/${profile.id}`, { method: 'PUT', json: body }) : api<Profile>('/profiles', { method: 'POST', json: body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profilesKey })
      toast.success(profile ? 'Profil modifié.' : 'Profil créé.')
      onOpenChange(false)
    },
    onError: (error) => {
      const fields = fieldErrors(error)
      if (Object.keys(fields).length) setErrors(fields)
      else toast.error(error.message)
    },
  })

  const set = (key: keyof ProfileInput) => (value: string) => setValues((v) => ({ ...v, [key]: value }))
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = schema.safeParse(values)
    const found: Errors = {}
    if (!parsed.success) for (const issue of parsed.error.issues) found[issue.path[0] as keyof ProfileInput] ??= issue.message
    for (const key of ['display_name', 'initials'] as const) if (hasUnstorable(values[key])) found[key] = UNSTORABLE_MESSAGE
    setErrors(found)
    if (parsed.success && !Object.keys(found).length) save.mutate(parsed.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{profile ? 'Modifier le profil' : 'Nouveau profil'}</DialogTitle>
            <DialogDescription>Le nom et les initiales apparaissent dans l'en-tête et sur les fiches.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.display_name}>
              <FieldLabel htmlFor="profile-name">Nom affiché</FieldLabel>
              <Input id="profile-name" name="display_name" autoComplete="off" value={values.display_name} onChange={(e) => set('display_name')(e.target.value)} aria-invalid={!!errors.display_name} aria-describedby={errors.display_name ? 'profile-name-error' : undefined} />
              {errors.display_name && <FieldError id="profile-name-error">{errors.display_name}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.initials}>
              <FieldLabel htmlFor="profile-initials">Initiales</FieldLabel>
              <Input id="profile-initials" name="initials" autoComplete="off" className="w-24" value={values.initials} onChange={(e) => set('initials')(e.target.value)} aria-invalid={!!errors.initials} aria-describedby={errors.initials ? 'profile-initials-error' : 'profile-initials-help'} />
              <FieldDescription id="profile-initials-help">1 à 3 caractères.</FieldDescription>
              {errors.initials && <FieldError id="profile-initials-error">{errors.initials}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.color}>
              <FieldLabel id="profile-color-label">Couleur</FieldLabel>
              <RadioGroup
                aria-labelledby="profile-color-label"
                value={values.color.toLowerCase()}
                onValueChange={set('color')}
                className="flex w-auto flex-wrap items-center gap-2"
              >
                {PRESETS.map((color) => (
                  <RadioGroupItem
                    key={color}
                    value={color}
                    aria-label={color}
                    className="size-8 border-2 border-background ring-1 ring-border data-[state=checked]:ring-2 data-[state=checked]:ring-foreground"
                    style={{ backgroundColor: color }}
                  />
                ))}
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="color" name="color" aria-label="Autre couleur" value={values.color} onChange={(e) => set('color')(e.target.value)} className="h-8 w-10 cursor-pointer rounded-md border border-input bg-transparent p-0.5" />
                  <span className="tabular-nums">{values.color}</span>
                </label>
              </RadioGroup>
              {errors.color && <FieldError>{errors.color}</FieldError>}
            </Field>
            <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              Aperçu
              <Paraphe initials={values.initials.trim() || '··'} color={values.color} />
              <span className="truncate font-medium text-foreground">{values.display_name.trim() || 'Nom du profil'}</span>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner data-icon="inline-start" />}
              {profile ? 'Enregistrer' : 'Créer le profil'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
