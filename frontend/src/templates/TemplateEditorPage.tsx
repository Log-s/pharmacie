import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ArchiveIcon, CircleAlertIcon, HistoryIcon, MousePointerClickIcon } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { StatusPage } from '@/components/StatusPage'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FormRenderer, type FormValue } from '@/forms/renderer'
import { api, ApiError, queryClient } from '@/lib/api'
import { templatesKey, type TemplateDetail, type TemplateSummary, type TemplateVersion, useTemplate } from '@/templates/api'
import { PropertiesPanel, type NodeIssue } from '@/templates/editor/PropertiesPanel'
import { findNode, issueTarget } from '@/templates/editor/tree'
import { TreeEditor } from '@/templates/editor/TreeEditor'
import { templateTree, walk, type TemplateTree } from '@/templates/schema'

/** `/templates/nouveau` (name, then the editor) and `/templates/:templateId` (the editor). */
export default function TemplateEditorPage() {
  const { templateId } = useParams()
  return templateId ? <ExistingTemplate key={templateId} id={templateId} /> : <NewTemplate />
}

function NewTemplate() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const create = useMutation({
    mutationFn: () => api<TemplateSummary>('/templates', { method: 'POST', json: { name: name.trim() } }),
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: templatesKey })
      toast.success(`Template « ${template.name} » créé : construisez sa structure, puis publiez-le.`)
      navigate(`/templates/${template.id}`, { replace: true })
    },
    onError: (e) => {
      setError(e.message)
      document.getElementById('template-name')?.focus()
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = !name.trim() ? 'Donnez un nom au template.' : name.trim().length > 200 ? 'Le nom dépasse 200 caractères.' : undefined
    setError(message)
    if (message) document.getElementById('template-name')?.focus()
    else create.mutate()
  }
  return (
    <>
      <PageHeader title="Nouveau template" description="Nommez le modèle de fiche ; vous construirez ensuite sa structure avec l'aperçu à côté." />
      <Card className="max-w-lg">
        <CardContent>
          <form id="new-template" onSubmit={submit} noValidate>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="template-name">Nom du template</FieldLabel>
              <Input
                id="template-name"
                name="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(undefined)
                }}
                placeholder="Contrôle des préparations…"
                autoComplete="off"
                aria-invalid={!!error || undefined}
                aria-describedby="template-name-error"
              />
              <FieldError id="template-name-error">{error}</FieldError>
            </Field>
          </form>
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" form="new-template" disabled={create.isPending}>
            {create.isPending && <Spinner data-icon="inline-start" aria-label="Création en cours…" />}
            Créer le template
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/templates">Annuler</Link>
          </Button>
        </CardFooter>
      </Card>
    </>
  )
}

function ExistingTemplate({ id }: { id: string }) {
  const detail = useTemplate(id)
  if (detail.isPending)
    return (
      <>
        <PageHeader title="Éditeur de template" />
        <Skeleton className="h-96 w-full" />
      </>
    )
  if (detail.isError)
    return detail.error instanceof ApiError && (detail.error.status === 404 || detail.error.status === 422) ? (
      <StatusPage title="Template introuvable" description="Ce template n'existe pas ou a été supprimé." />
    ) : (
      <StatusPage title="Chargement impossible" description={detail.error.message} />
    )
  // A new version (publish, restore) remounts the editor on the published tree.
  return <Editor key={detail.data.versions.at(-1)?.id ?? 'brouillon'} template={detail.data} />
}

const publishedOn = (version: TemplateVersion) => format(new Date(version.published_at), "d MMMM yyyy 'à' HH:mm", { locale: fr })
const fieldCount = (version: TemplateVersion) => [...walk(version.schema_json.nodes)].length
const cleanMessage = (msg: string) => msg.replace(/^Value error, /, '')

type Issues = { general: string[]; byNode: Map<string, NodeIssue[]> }

function Editor({ template }: { template: TemplateDetail }) {
  const latest = template.versions.at(-1)
  const base = useMemo<TemplateTree>(() => latest?.schema_json ?? { nodes: [] }, [latest])
  const [tree, setTree] = useState(base)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState(false) // client errors show after the first publish attempt
  const [serverIssues, setServerIssues] = useState<Issues | null>(null)
  const [preview, setPreview] = useState<'edit' | 'readonly'>('edit')
  const [previewValue, setPreviewValue] = useState<FormValue>()
  const dirty = JSON.stringify(tree) !== JSON.stringify(base)
  const parsed = useMemo(() => templateTree.safeParse(tree), [tree])

  const issues: Issues = { general: [], byNode: new Map() }
  const addIssue = (target: Issues, nodeId: string | null, issue: NodeIssue) => {
    if (!nodeId) return target.general.push(issue.message)
    target.byNode.set(nodeId, [...(target.byNode.get(nodeId) ?? []), issue])
  }
  if (checked && !parsed.success)
    for (const issue of parsed.error.issues) {
      const { nodeId, rest } = issueTarget(tree, issue.path)
      addIssue(issues, nodeId, { rest, message: issue.message })
    }
  if (serverIssues) {
    issues.general.push(...serverIssues.general)
    for (const [nodeId, list] of serverIssues.byNode) for (const issue of list) addIssue(issues, nodeId, issue)
  }
  const issueCount = issues.general.length + [...issues.byNode.values()].reduce((n, list) => n + list.length, 0)

  const change = (next: TemplateTree) => {
    setTree(next)
    setServerIssues(null)
  }

  const publish = useMutation({
    mutationFn: (body: TemplateTree) => api<TemplateVersion>(`/templates/${template.id}/versions`, { method: 'POST', json: body }),
    onSuccess: (version) => {
      toast.success(`Version ${version.version} publiée : les nouvelles fiches l'utilisent.`)
      queryClient.invalidateQueries({ queryKey: templatesKey })
    },
    onError: (error) => {
      const found: Issues = { general: [], byNode: new Map() }
      if (error instanceof ApiError && Array.isArray(error.detail))
        for (const item of error.detail as { loc?: PropertyKey[]; msg?: string }[]) {
          const { nodeId, rest } = issueTarget(tree, item.loc ?? [])
          addIssue(found, nodeId, { rest, message: cleanMessage(item.msg ?? '') })
        }
      else {
        found.general.push(cleanMessage(error.message))
        for (const node of walk(tree.nodes))
          if (node.annex_ref && error.message.includes(node.annex_ref.annex_id))
            addIssue(found, node.id, { rest: ['annex_ref'], message: "Cette annexe n'existe plus : choisissez-en une autre ou retirez-la." })
      }
      setServerIssues(found)
      const first = found.byNode.keys().next().value
      if (first) setSelectedId(first)
      document.getElementById('publication-errors')?.focus()
    },
  })

  const onPublish = () => {
    setChecked(true)
    setServerIssues(null)
    if (parsed.success) return publish.mutate(parsed.data)
    const first = parsed.error.issues.map((i) => issueTarget(tree, i.path).nodeId).find(Boolean)
    if (first) setSelectedId(first)
    requestAnimationFrame(() => document.getElementById('publication-errors')?.focus())
  }

  // Unsaved draft: confirm before leaving the page (in-app navigation and tab close).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const selected = selectedId ? findNode(tree, selectedId) : undefined
  const nextNumber = (latest?.version ?? 0) + 1
  const archived = !!template.archived_at

  return (
    <>
      <PageHeader
        title={template.name}
        description="Construisez la structure de la fiche ; l'aperçu montre ce que l'équipe remplira. Chaque publication crée une nouvelle version."
        actions={
          <>
            <VersionHistory template={template} dirty={dirty} />
            {!archived && <ArchiveButton template={template} />}
            <Button size="lg" onClick={onPublish} disabled={publish.isPending || !dirty}>
              {publish.isPending && <Spinner data-icon="inline-start" aria-label="Publication en cours…" />}
              Publier la version {nextNumber}
            </Button>
          </>
        }
      />
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {archived && <Badge variant="secondary">Archivé</Badge>}
        <span className="tabular-nums">
          {latest ? `Version ${latest.version} publiée le ${publishedOn(latest)}.` : 'Jamais publié.'}
        </span>
        {dirty ? (
          <Badge variant="outline" className="border-warning/40 bg-warning-surface text-warning">
            Modifications non publiées
          </Badge>
        ) : (
          latest && <span>À jour.</span>
        )}
      </div>
      {archived && (
        <Alert className="mb-4">
          <ArchiveIcon />
          <AlertTitle>Template archivé</AlertTitle>
          <AlertDescription>Il n'est plus proposé pour les nouvelles fiches ; les fiches existantes restent lisibles.</AlertDescription>
        </Alert>
      )}
      {issueCount > 0 && (
        <Alert variant="destructive" className="mb-4" id="publication-errors" tabIndex={-1}>
          <CircleAlertIcon />
          <AlertTitle>
            {serverIssues ? 'Le serveur a refusé la publication' : `Publication impossible : ${issueCount} erreur${issueCount > 1 ? 's' : ''} à corriger`}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-0.5">
              {issues.general.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
              {[...issues.byNode].map(([nodeId, list]) => (
                <li key={nodeId}>
                  <button type="button" className="text-left underline underline-offset-4 hover:no-underline" onClick={() => setSelectedId(nodeId)}>
                    « {findNode(tree, nodeId)?.label.trim() || 'Sans libellé'} » : {list.map((i) => i.message).join(' ')}
                  </button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Structure</h2>
            </CardTitle>
            <CardDescription>Glissez les champs par la poignée pour les ranger, y compris dans une catégorie ou sous une option.</CardDescription>
          </CardHeader>
          <CardContent>
            <TreeEditor
              tree={tree}
              onChange={change}
              selectedId={selectedId}
              onSelect={setSelectedId}
              invalidIds={new Set(issues.byNode.keys())}
            />
          </CardContent>
        </Card>

        <Card className="xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Propriétés</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <PropertiesPanel key={selected.id} tree={tree} node={selected} issues={issues.byNode.get(selected.id) ?? []} onChange={change} />
            ) : (
              <Empty className="p-4">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MousePointerClickIcon />
                  </EmptyMedia>
                  <EmptyTitle>Aucun champ sélectionné</EmptyTitle>
                  <EmptyDescription>Choisissez un champ dans la structure pour modifier son libellé, ses options ou son annexe.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2 xl:sticky xl:top-4 xl:col-span-1 xl:max-h-[calc(100svh-2rem)] xl:overflow-y-auto">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Aperçu</h2>
            </CardTitle>
            <CardDescription>La fiche telle que l'équipe la verra. Rien n'est enregistré ici.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={preview}
              onValueChange={(value) => value && setPreview(value as 'edit' | 'readonly')}
              aria-label="Mode de l'aperçu"
            >
              <ToggleGroupItem value="edit">Saisie</ToggleGroupItem>
              <ToggleGroupItem value="readonly">Lecture seule</ToggleGroupItem>
            </ToggleGroup>
            {tree.nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ajoutez un premier champ dans la structure pour voir la fiche se construire.</p>
            ) : (
              <section aria-label="Aperçu de la fiche">
                {preview === 'edit' ? (
                  <FormRenderer
                    tree={tree}
                    headingLevel={3}
                    onChange={setPreviewValue}
                    onSubmit={() => toast.success("Saisie valide. L'aperçu n'enregistre rien.")}
                  >
                    <Button type="submit" variant="outline" className="w-fit">
                      Tester la validation
                    </Button>
                  </FormRenderer>
                ) : (
                  <FormRenderer tree={tree} mode="readonly" headingLevel={3} defaultValue={previewValue} />
                )}
              </section>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={blocker.state === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans publier ?</AlertDialogTitle>
            <AlertDialogDescription>Les modifications non publiées de ce template seront perdues.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Rester sur l'éditeur</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              Quitter sans publier
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function VersionHistory({ template, dirty }: { template: TemplateDetail; dirty: boolean }) {
  const [open, setOpen] = useState(false)
  const restore = useMutation({
    mutationFn: (version: number) => api<TemplateVersion>(`/templates/${template.id}/versions/${version}/restore`, { method: 'POST' }),
    onSuccess: (created, from) => {
      toast.success(`Version ${from} restaurée : publiée comme version ${created.version}.`)
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: templatesKey })
    },
    onError: (error) => toast.error(error.message),
  })
  const versions = [...template.versions].reverse()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        <HistoryIcon data-icon="inline-start" />
        Historique des versions
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Historique des versions</DialogTitle>
          <DialogDescription>
            Les versions sont figées. Restaurer republie l'ancienne structure comme nouvelle version ; les fiches existantes gardent la leur.
          </DialogDescription>
        </DialogHeader>
        {dirty && <p className="text-sm text-warning">Restaurer remplace aussi vos modifications non publiées.</p>}
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune version publiée pour l'instant.</p>
        ) : (
          <ol className="flex max-h-80 flex-col divide-y overflow-y-auto">
            {versions.map((version, index) => (
              <li key={version.id} className="flex items-center justify-between gap-4 py-2">
                <div className="flex flex-col">
                  <span className="text-sm font-medium tabular-nums">
                    Version {version.version}
                    {index === 0 && (
                      <Badge variant="secondary" className="ml-2">
                        Actuelle
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Publiée le {publishedOn(version)}, {fieldCount(version)} champ{fieldCount(version) > 1 ? 's' : ''}
                  </span>
                </div>
                {index > 0 && (
                  <Button variant="outline" size="sm" disabled={restore.isPending} onClick={() => restore.mutate(version.version)}>
                    Restaurer la version {version.version}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ArchiveButton({ template }: { template: TemplateDetail }) {
  const archive = useMutation({
    mutationFn: () => api<TemplateSummary>(`/templates/${template.id}/archive`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`Template « ${template.name} » archivé.`)
      queryClient.invalidateQueries({ queryKey: templatesKey })
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <AlertDialog>
      <AlertDialogTrigger className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        <ArchiveIcon data-icon="inline-start" />
        Archiver
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archiver « {template.name} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            Il ne sera plus proposé pour les nouvelles fiches. Les fiches existantes restent consultables et modifiables. Il n'est pas possible de le
            désarchiver.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={() => archive.mutate()}>Archiver</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
