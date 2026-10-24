import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

async function fetchHealth(): Promise<{ status: string }> {
  const response = await fetch('/api/health')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// Placeholder until U3 builds the app shell: proves the front reaches the API.
export default function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth })

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>Fiches de la pharmacie</h1>
          </CardTitle>
          <CardDescription>L’application est en cours de construction.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2" aria-live="polite">
          <span>État du serveur :</span>
          {health.isPending && <Badge variant="secondary">vérification…</Badge>}
          {health.isSuccess && <Badge>disponible</Badge>}
          {health.isError && <Badge variant="destructive">injoignable</Badge>}
        </CardContent>
      </Card>
    </main>
  )
}
