import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { ArrowDownIcon, ArrowUpIcon, CircleAlertIcon, GripVerticalIcon, PaperclipIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { createContext, Fragment, useContext, useState } from 'react'
import { cn } from '@/lib/utils'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { isGroup, NODE_TYPE_LABELS, walk, type NodeType, type TemplateNode, type TemplateTree } from '@/templates/schema'
import { NODE_ICONS, NODE_TYPES } from './icons'
import { containerLabel, findNode, insertNode, moveNode, newNode, removeNode, ROOT, subtreeIds } from './tree'

type TreeProps = {
  tree: TemplateTree
  onChange: (tree: TemplateTree) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Node ids that carry a validation error. */
  invalidIds: Set<string>
}
type Ctx = TreeProps & { blocked: Set<string>; askRemove: (node: TemplateNode) => void }
const TreeContext = createContext<Ctx | null>(null)
const useTree = () => useContext(TreeContext)!

const name = (node: { label: string }) => node.label.trim() || 'Sans libellé'

/**
 * The template structure as a nested list. Drag a node by its handle onto any gap (also inside
 * categories and under options); arrow buttons and the « Emplacement » field of the properties
 * panel do the same without a pointer.
 */
export function TreeEditor(props: TreeProps) {
  const { tree, onChange, onSelect } = props
  const [active, setActive] = useState<TemplateNode | null>(null)
  const [removing, setRemoving] = useState<TemplateNode | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor))
  const blocked = active ? subtreeIds(active) : new Set<string>()

  const remove = (node: TemplateNode) => {
    onChange(removeNode(tree, node.id))
    if (props.selectedId && subtreeIds(node).has(props.selectedId)) onSelect(null)
  }
  const askRemove = (node: TemplateNode) => (subtreeIds(node).size > 1 + (isGroup(node) ? node.options.length : 0) ? setRemoving(node) : remove(node))

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActive(null)
    const slot = over?.data.current as { container: string; index: number } | undefined
    if (slot) onChange(moveNode(tree, String(dragged.id), slot.container, slot.index))
  }
  const slotName = (id: unknown) => {
    const slot = id ? (String(id).split(':') as [string, string, string]) : null
    return slot ? `position ${Number(slot[2]) + 1} dans ${containerLabel(tree, slot[1])}` : ''
  }

  return (
    <TreeContext.Provider value={{ ...props, blocked, askRemove }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active: dragged }) => setActive(findNode(tree, String(dragged.id)) ?? null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Pour déplacer ce champ : Espace ou Entrée pour le saisir, flèches pour choisir sa place, Espace pour le déposer, Échap pour annuler.',
          },
          announcements: {
            onDragStart: ({ active: a }) => `Champ « ${name(findNode(tree, String(a.id)) ?? { label: '' })} » saisi.`,
            onDragOver: ({ over }) => (over ? `Au-dessus de ${slotName(over.id)}.` : 'Hors de tout emplacement.'),
            onDragEnd: ({ over }) => (over ? `Champ déposé en ${slotName(over.id)}.` : 'Champ relâché à sa place d’origine.'),
            onDragCancel: () => 'Déplacement annulé.',
          },
        }}
      >
        <Container id={ROOT} nodes={tree.nodes} label="Racine du template" />
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="flex w-64 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-md">
              <TypeIcon type={active.type} />
              <span className="truncate">{name(active)}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {removing && name(removing)} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les champs qu'il contient sont supprimés avec lui. Rien n'est enregistré avant la publication.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => removing && remove(removing)}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TreeContext.Provider>
  )
}

function TypeIcon({ type }: { type: NodeType }) {
  const Icon = NODE_ICONS[type]
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
}

function Container({ id, nodes, label }: { id: string; nodes: TemplateNode[]; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      {nodes.length === 0 ? (
        <Slot container={id} index={0} empty />
      ) : (
        <ol className="flex flex-col">
          {nodes.map((node, index) => (
            <Fragment key={node.id}>
              <Slot container={id} index={index} />
              <li>
                <NodeBlock node={node} container={id} index={index} count={nodes.length} />
              </li>
            </Fragment>
          ))}
          <Slot container={id} index={nodes.length} />
        </ol>
      )}
      <AddMenu container={id} label={label} />
    </div>
  )
}

function Slot({ container, index, empty }: { container: string; index: number; empty?: boolean }) {
  const { blocked } = useTree()
  const { setNodeRef, isOver, active } = useDroppable({ id: `slot:${container}:${index}`, data: { container, index }, disabled: blocked.has(container) })
  if (empty)
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground',
          active && !blocked.has(container) && 'border-primary/60',
          isOver && 'border-primary bg-accent text-foreground',
        )}
      >
        Vide : glissez un champ ici ou ajoutez-en un.
      </div>
    )
  return (
    <li ref={setNodeRef} aria-hidden="true" className="flex h-2 items-center">
      <span className={cn('h-0.5 w-full rounded-full', isOver && 'bg-primary')} />
    </li>
  )
}

function NodeBlock({ node, container, index, count }: { node: TemplateNode; container: string; index: number; count: number }) {
  const { tree, onChange, selectedId, onSelect, invalidIds, askRemove } = useTree()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: node.id })
  const label = name(node)
  const selected = selectedId === node.id
  const invalid = invalidIds.has(node.id)
  return (
    <div ref={setNodeRef} className={cn('flex flex-col gap-1', isDragging && 'opacity-40')} data-node={node.id}>
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-lg border bg-card p-0.5 pr-1',
          selected && 'border-primary bg-accent ring-1 ring-primary ring-inset',
          invalid && 'border-destructive',
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Déplacer « ${label} »`}
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
        >
          <GripVerticalIcon aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <TypeIcon type={node.type} />
          <span className="truncate text-sm font-medium">{label}</span>
          <span className="sr-only">, {NODE_TYPE_LABELS[node.type]}</span>
          {node.required && (
            <span className="shrink-0 text-destructive" aria-hidden="true">
              *
            </span>
          )}
          {node.required && <span className="sr-only">, obligatoire</span>}
          {node.annex_ref && <PaperclipIcon aria-label="annexe liée" className="size-3.5 shrink-0 text-muted-foreground" />}
          {invalid && <CircleAlertIcon aria-label="contient une erreur" className="ml-auto size-4 shrink-0 text-destructive" />}
        </button>
        <Button variant="ghost" size="icon-sm" aria-label={`Monter « ${label} »`} disabled={index === 0} onClick={() => onChange(moveNode(tree, node.id, container, index - 1))}>
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Descendre « ${label} »`}
          disabled={index === count - 1}
          onClick={() => onChange(moveNode(tree, node.id, container, index + 2))}
        >
          <ArrowDownIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Supprimer « ${label} »`} onClick={() => askRemove(node)}>
          <Trash2Icon />
        </Button>
      </div>
      {node.type === 'category' && (
        <div className="ml-3.5 border-l-2 pl-3">
          <Container id={node.id} nodes={node.children} label={`Catégorie « ${label} »`} />
        </div>
      )}
      {isGroup(node) &&
        node.options.map((option) => (
          <div key={option.id} className="ml-3.5 flex flex-col gap-1 border-l-2 pt-1 pl-3">
            <p className="text-xs text-muted-foreground">
              Si « {name(option)} » {node.type === 'checkbox_group' ? 'est coché' : 'est choisi'} :
            </p>
            <Container id={option.id} nodes={option.children} label={`« ${label} » si « ${name(option)} »`} />
          </div>
        ))}
    </div>
  )
}

function AddMenu({ container, label }: { container: string; label: string }) {
  const { tree, onChange, onSelect } = useTree()
  const hasReference = [...walk(tree.nodes)].some((n) => n.type === 'reference')
  const add = (type: NodeType) => {
    const node = newNode(type)
    onChange(insertNode(tree, node, container))
    onSelect(node.id)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Ajouter un champ dans ${label}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-fit text-muted-foreground')}>
        <PlusIcon data-icon="inline-start" />
        Ajouter un champ
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {NODE_TYPES.map((type) => {
            const Icon = NODE_ICONS[type]
            const taken = type === 'reference' && hasReference
            return (
              <DropdownMenuItem key={type} disabled={taken} onSelect={() => add(type)}>
                <Icon />
                {NODE_TYPE_LABELS[type]}
                {taken && <span className="text-xs text-muted-foreground">(déjà présente)</span>}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
