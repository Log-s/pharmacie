import { useQuery } from '@tanstack/react-query'
import { FileTextIcon, XIcon } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { indexTree, pathLabel, useAnnexTree } from '@/annexes/api'
import { api, ApiError } from '@/lib/api'
import type { Annex } from '@/templates/api'

/** Links a node to a note (`GET /api/annexes?q=`), showing its folder path; shows « Annexe supprimée » for a dangling id. */
export function AnnexPicker({ id, value, onChange }: { id: string; value: string | null; onChange: (annexId: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const results = useQuery({
    queryKey: ['annexes', 'list', q],
    queryFn: () => api<Annex[]>(`/annexes?q=${encodeURIComponent(q)}`),
    enabled: open,
  })
  const current = useQuery({
    queryKey: ['annexes', 'one', value],
    queryFn: () => api<Annex>(`/annexes/${value}`),
    enabled: !!value,
  })
  const tree = useAnnexTree()
  const index = useMemo(() => (open && tree.data ? indexTree(tree.data) : undefined), [open, tree.data])
  const missing = current.error instanceof ApiError && current.error.status === 404

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm">
          <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className={missing ? 'flex-1 truncate text-destructive' : 'flex-1 truncate'}>
            {missing ? 'Annexe supprimée\u00a0: choisissez-en une autre' : (current.data?.title ?? 'Chargement…')}
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Retirer l'annexe" onClick={() => onChange(null)}>
            <XIcon />
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aucune annexe liée.</p>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger id={id} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit')}>
          {value ? "Changer d'annexe" : 'Lier une annexe'}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <Input
            type="search"
            aria-label="Rechercher une annexe"
            placeholder="Titre ou extrait…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
          {results.isPending ? (
            <Spinner aria-label="Recherche en cours…" />
          ) : results.isError ? (
            <p role="alert" className="text-sm text-destructive">{results.error.message}</p>
          ) : results.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {q ? 'Aucune annexe ne correspond à cette recherche.' : 'Aucune annexe\u00a0: ajoutez-en depuis le menu Annexes.'}
            </p>
          ) : (
            <ul className="-mx-1 flex max-h-64 flex-col overflow-y-auto">
              {results.data.map((annex) => (
                <li key={annex.id}>
                  <button
                    type="button"
                    aria-current={annex.id === value || undefined}
                    onClick={() => {
                      onChange(annex.id)
                      setOpen(false)
                    }}
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=true]:bg-accent"
                  >
                    <span className="truncate text-sm font-medium">{annex.title}</span>
                    {index && <span className="truncate text-xs text-muted-foreground">{pathLabel(index, annex.folder_id)}</span>}
                    {annex.excerpt && <span className="line-clamp-2 text-xs text-muted-foreground">{annex.excerpt}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
