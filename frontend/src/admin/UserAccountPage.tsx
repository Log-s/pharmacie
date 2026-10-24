import { CheckIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'

const MIN_LENGTH = 12 // mirrors backend/app/services/passwords.py; zxcvbn runs server-side

export default function UserAccountPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const save = useMutation({
    mutationFn: () => api('/admin/user-password', { method: 'POST', json: { password } }),
    onSuccess: () => {
      toast.success('Mot de passe du compte utilisateur modifié. Ses sessions ouvertes sont fermées.')
      setPassword('')
      setConfirm('')
    },
    onError: (error) => {
      setErrors({ password: error.message })
      document.getElementById('user-password')?.focus() // shadcn Input takes no ref under React 18
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = {
      password: password.length < MIN_LENGTH ? `Le mot de passe doit contenir au moins ${MIN_LENGTH} caractères.` : undefined,
      confirm: confirm !== password ? 'Les deux saisies ne correspondent pas : ressaisissez la confirmation.' : undefined,
    }
    setErrors(next)
    if (next.password || next.confirm) {
      document.getElementById(next.password ? 'user-password' : 'user-password-confirm')?.focus()
    } else save.mutate()
  }

  const longEnough = password.length >= MIN_LENGTH
  return (
    <>
      <PageHeader
        title="Compte utilisateur"
        description="Le compte partagé par l'équipe. Un nouveau mot de passe ferme toutes ses sessions ouvertes ; les profils et les fiches ne changent pas."
      />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Nouveau mot de passe</h2>
          </CardTitle>
          <CardDescription>
            Au moins {MIN_LENGTH} caractères et difficile à deviner : plusieurs mots sans rapport entre eux font un bon mot de passe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="user-password-form" onSubmit={submit} noValidate>
            <FieldGroup>
              <Field data-invalid={!!errors.password || undefined}>
                <FieldLabel htmlFor="user-password">Nouveau mot de passe</FieldLabel>
                <Input
                  id="user-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setErrors({})
                  }}
                  aria-invalid={!!errors.password || undefined}
                  aria-describedby="user-password-length user-password-error"
                />
                <FieldDescription id="user-password-length" className="flex items-center gap-1 tabular-nums" aria-live="polite">
                  {longEnough && <CheckIcon className="size-4 text-success" aria-hidden="true" />}
                  {longEnough
                    ? `Longueur suffisante (${password.length} caractères). La robustesse est vérifiée à l'enregistrement.`
                    : `${password.length} caractère${password.length > 1 ? 's' : ''} sur ${MIN_LENGTH} minimum.`}
                </FieldDescription>
                <FieldError id="user-password-error">{errors.password}</FieldError>
              </Field>
              <Field data-invalid={!!errors.confirm || undefined}>
                <FieldLabel htmlFor="user-password-confirm">Confirmation</FieldLabel>
                <Input
                  id="user-password-confirm"
                  name="new-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value)
                    setErrors({})
                  }}
                  aria-invalid={!!errors.confirm || undefined}
                  aria-describedby="user-password-confirm-error"
                />
                <FieldError id="user-password-confirm-error">{errors.confirm}</FieldError>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <Button type="submit" form="user-password-form" disabled={save.isPending}>
            {save.isPending && <Spinner data-icon="inline-start" aria-label="Enregistrement en cours…" />}
            Définir le mot de passe
          </Button>
        </CardFooter>
      </Card>
      <p className="mt-4 max-w-lg text-sm text-muted-foreground">
        Le mot de passe administrateur se réinitialise uniquement depuis le serveur, avec la commande{' '}
        <code translate="no" className="rounded-sm bg-muted px-1 py-0.5 text-xs">python -m app.cli reset-admin-password</code>.
      </p>
    </>
  )
}
