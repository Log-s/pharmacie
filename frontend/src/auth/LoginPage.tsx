import { CircleAlertIcon, LockIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { type Location, Navigate, useLocation } from 'react-router'
import { Brand } from '@/components/Brand'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type Role, useLogin, useMe } from '@/auth/session'
import { ApiError } from '@/lib/api'

const ERROR_TITLES: Record<number, string> = {
  401: 'Connexion refusée',
  423: 'Compte verrouillé',
  429: 'Trop de tentatives',
}

export default function LoginPage() {
  const me = useMe()
  const login = useLogin()
  const from = (useLocation().state as { from?: Location } | null)?.from
  const [role, setRole] = useState<Role>('user')
  const [password, setPassword] = useState('')

  useEffect(() => {
    document.title = 'Connexion – Interventions pharmaceutiques'
  }, [])

  if (me.data) return <Navigate to={from ?? '/'} replace />

  const error = login.error
  const status = error instanceof ApiError ? error.status : 0
  const locked = status === 423 || status === 429

  function submit(event: FormEvent) {
    event.preventDefault()
    login.mutate(
      { role, password },
      {
        onError: () => {
          setPassword('')
          document.getElementById('login-password')?.focus() // shadcn Input takes no ref under React 18
        },
      },
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[10vh] pb-12">
        <Card className="h-fit w-full max-w-sm shadow-overlay">
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold tracking-tight">Connexion</h1>
            </CardTitle>
            <CardDescription>Choisissez le compte, puis saisissez son mot de passe.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate>
              <FieldGroup>
                <FieldSet>
                  <FieldLegend variant="label" id="login-role">
                    Compte
                  </FieldLegend>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    spacing={0}
                    className="w-full"
                    aria-labelledby="login-role"
                    value={role}
                    onValueChange={(value) => value && setRole(value as Role)}
                  >
                    <ToggleGroupItem value="user" className="flex-1">
                      Utilisateur
                    </ToggleGroupItem>
                    <ToggleGroupItem value="admin" className="flex-1">
                      Administrateur
                    </ToggleGroupItem>
                  </ToggleGroup>
                </FieldSet>
                <Field data-invalid={status === 401 || undefined}>
                  <FieldLabel htmlFor="login-password">Mot de passe</FieldLabel>
                  <Input
                    id="login-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={status === 401 || undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                </Field>
                {error && (
                  <Alert variant="destructive" id="login-error">
                    {locked ? <LockIcon /> : <CircleAlertIcon />}
                    <AlertTitle>{ERROR_TITLES[status] ?? 'Connexion impossible'}</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" size="lg" disabled={login.isPending || !password}>
                  {login.isPending && <Spinner data-icon="inline-start" aria-label="Connexion en cours…" />}
                  Se connecter
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
