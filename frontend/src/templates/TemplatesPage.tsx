import { useMutation } from '@tanstack/react-query'
import { ArchiveIcon, EllipsisIcon, FileStackIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
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
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, queryClient } from '@/lib/api'
import { templatesKey, type TemplateSummary, useTemplates } from '@/templates/api'

/** Admin list of templates (U5): open the editor, archive, delete (refused while forms use it). */
export default function TemplatesPage() {
  const list = useTemplates()
  const [confirm, setConfirm] = useState<{ kind: 'archive' | 'delete'; template: TemplateSummary } | null>(null)
  const act = useMutation({
    mutationFn: ({ kind, template }: { kind: 'archive' | 'delete'; template: TemplateSummary }) =>
      kind === 'archive' ? api(`/templates/${template.id}/archive`, { method: 'POST' }) : api(`/templates/${template.id}`, { method: 'DELETE' }),
    onSuccess: (_result, { kind, template }) => {
      toast.success(kind === 'archive' ? `Template « ${template.name} » archivé.` : `Template « ${template.name} » supprimé.`)
      queryClient.invalidateQueries({ queryKey: templatesKey })
    },
    onError: (error) => toast.error(error.message), // 409: used by forms, archive it instead
  })
  // Active first, then archived; each group keeps the API's name order.
  const templates = [...(list.data ?? [])].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at))

  return (
    <>
      <PageHeader
        title="Templates"
        description="Les modèles de fiches. Chaque publication crée une version figée ; une fiche garde la version avec laquelle elle a été créée."
        actions={
          <Button asChild>
            <Link to="/templates/nouveau">
              <PlusIcon data-icon="inline-start" />
              Nouveau template
            </Link>
          </Button>
        }
      />
      {list.isPending ? (
        <div className="flex flex-col gap-2" aria-label="Chargement des templates…">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : list.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Liste indisponible</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : templates.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileStackIcon />
            </EmptyMedia>
            <EmptyTitle>Aucun template</EmptyTitle>
            <EmptyDescription>Créez le premier modèle de fiche&nbsp;: l'équipe pourra ensuite remplir des fiches à partir de lui.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/templates/nouveau">Créer un template</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Version publiée</TableHead>
                <TableHead>État</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id} className={template.archived_at ? 'text-muted-foreground' : undefined}>
                  <TableCell className="max-w-80">
                    <Link
                      to={`/templates/${template.id}`}
                      className="block truncate rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {template.name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {template.latest_version ? `Version ${template.latest_version}` : <span className="text-muted-foreground">Jamais publié</span>}
                  </TableCell>
                  <TableCell>{template.archived_at ? <Badge variant="secondary">Archivé</Badge> : <Badge variant="outline">Actif</Badge>}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label={`Actions pour « ${template.name} »`} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
                        <EllipsisIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem asChild>
                            <Link to={`/templates/${template.id}`}>
                              <PencilIcon />
                              Modifier
                            </Link>
                          </DropdownMenuItem>
                          {!template.archived_at && (
                            <DropdownMenuItem onSelect={() => setConfirm({ kind: 'archive', template })}>
                              <ArchiveIcon />
                              Archiver
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: 'delete', template })}>
                            <Trash2Icon />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'archive' ? 'Archiver' : 'Supprimer'} « {confirm?.template.name} »&nbsp;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'archive'
                ? "Il ne sera plus proposé pour les nouvelles fiches\u00a0; les fiches existantes restent consultables. Il n'est pas possible de le désarchiver."
                : 'Le template et toutes ses versions sont supprimés définitivement. Si des fiches l’utilisent, la suppression est refusée\u00a0: archivez-le plutôt.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant={confirm?.kind === 'delete' ? 'destructive' : 'default'} onClick={() => confirm && act.mutate(confirm)}>
              {confirm?.kind === 'archive' ? 'Archiver' : 'Supprimer définitivement'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
