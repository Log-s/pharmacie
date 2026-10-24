import { useState } from 'react'
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
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { isGroup, NODE_TYPE_LABELS, type TemplateNode, type TemplateOption, type TemplateTree } from '@/templates/schema'
import { AnnexPicker } from './AnnexPicker'
import { NODE_ICONS } from './icons'
import { listContainers, locate, moveNode, newOption, subtreeIds, updateNode } from './tree'

export type NodeIssue = { rest: PropertyKey[]; message: string }

/** Edits the selected node; every change goes straight into the draft tree (and the preview). */
export function PropertiesPanel({
  tree,
  node,
  issues,
  onChange,
}: {
  tree: TemplateTree
  node: TemplateNode
  issues: NodeIssue[]
  onChange: (tree: TemplateTree) => void
}) {
  const patch = (changes: Partial<TemplateNode>) => onChange(updateNode(tree, node.id, changes))
  const on = (field: string) => issues.filter((i) => i.rest[0] === field && i.rest.length === 1).map((i) => i.message)
  const optionIssue = (index: number) => issues.find((i) => i.rest[0] === 'options' && i.rest[1] === index)?.message
  const other = issues.filter((i) => !['label', 'help', 'max_length'].includes(String(i.rest[0])) && !(i.rest[0] === 'options' && i.rest.length > 1))
  const Icon = NODE_ICONS[node.type]
  const here = locate(tree, node.id)
  const blocked = subtreeIds(node)
  const targets = listContainers(tree).filter((c) => !blocked.has(c.id))
  const labelErrors = on('label')

  const setOptions = (options: TemplateOption[]) => patch({ options } as Partial<TemplateNode>)
  const [removingOption, setRemovingOption] = useState<TemplateOption | null>(null)

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
        {NODE_TYPE_LABELS[node.type]}
      </p>
      <FieldGroup>
        <Field data-invalid={labelErrors.length > 0 || undefined}>
          <FieldLabel htmlFor="prop-label">Libellé</FieldLabel>
          <Input
            id="prop-label"
            name="label"
            value={node.label}
            onChange={(event) => patch({ label: event.target.value })}
            aria-invalid={labelErrors.length > 0 || undefined}
            aria-describedby="prop-label-error"
            autoComplete="off"
          />
          <FieldError id="prop-label-error">{labelErrors.join(' ')}</FieldError>
        </Field>

        {node.type !== 'category' && (
          <Field orientation="horizontal">
            <Checkbox id="prop-required" checked={node.required} onCheckedChange={(checked) => patch({ required: checked === true })} />
            <FieldLabel htmlFor="prop-required" className="font-normal">
              Champ obligatoire
            </FieldLabel>
          </Field>
        )}

        <Field data-invalid={on('help').length > 0 || undefined}>
          <FieldLabel htmlFor="prop-help">Aide</FieldLabel>
          <Textarea
            id="prop-help"
            name="help"
            value={node.help ?? ''}
            onChange={(event) => patch({ help: event.target.value === '' ? null : event.target.value })}
            aria-describedby="prop-help-hint"
            className="min-h-12"
          />
          <FieldDescription id="prop-help-hint">Affichée sous le libellé, dans la fiche.</FieldDescription>
          <FieldError>{on('help').join(' ')}</FieldError>
        </Field>

        {node.type === 'text' && (
          <>
            <Field orientation="horizontal">
              <Checkbox id="prop-multiline" checked={node.multiline} onCheckedChange={(checked) => patch({ multiline: checked === true } as Partial<TemplateNode>)} />
              <FieldLabel htmlFor="prop-multiline" className="font-normal">
                Plusieurs lignes
              </FieldLabel>
            </Field>
            <Field data-invalid={on('max_length').length > 0 || undefined}>
              <FieldLabel htmlFor="prop-max-length">Longueur maximale</FieldLabel>
              <Input
                id="prop-max-length"
                name="max_length"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="w-32 tabular-nums"
                value={node.max_length ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  patch({ max_length: value === '' ? null : Number(value) } as Partial<TemplateNode>)
                }}
                aria-invalid={on('max_length').length > 0 || undefined}
                aria-describedby="prop-max-length-hint"
              />
              <FieldDescription id="prop-max-length-hint">En caractères. Vide&nbsp;: pas de limite.</FieldDescription>
              <FieldError>{on('max_length').join(' ')}</FieldError>
            </Field>
          </>
        )}

        {isGroup(node) && (
          <FieldSet>
            <FieldLegend variant="label">Options</FieldLegend>
            <FieldDescription>Chaque option peut contenir des champs, affichés seulement quand elle est {node.type === 'checkbox_group' ? 'cochée' : 'choisie'}.</FieldDescription>
            <ol className="flex flex-col gap-2">
              {node.options.map((option, index) => {
                const error = optionIssue(index)
                const move = (to: number) => {
                  const options = [...node.options]
                  options.splice(to, 0, ...options.splice(index, 1))
                  setOptions(options)
                }
                return (
                  <li key={option.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-0.5">
                      <Input
                        aria-label={`Libellé de l'option ${index + 1}`}
                        name={`option-${index + 1}`}
                        value={option.label}
                        onChange={(event) => setOptions(node.options.map((o) => (o.id === option.id ? { ...o, label: event.target.value } : o)))}
                        aria-invalid={!!error || undefined}
                        autoComplete="off"
                        className="mr-1"
                      />
                      <Button variant="ghost" size="icon-sm" aria-label={`Monter l'option ${index + 1}`} disabled={index === 0} onClick={() => move(index - 1)}>
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Descendre l'option ${index + 1}`}
                        disabled={index === node.options.length - 1}
                        onClick={() => move(index + 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Supprimer l'option ${index + 1}`}
                        disabled={node.options.length === 1}
                        onClick={() => (option.children.length ? setRemovingOption(option) : setOptions(node.options.filter((o) => o.id !== option.id)))}
                      >
                        <XIcon />
                      </Button>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    {option.children.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {option.children.length} champ{option.children.length > 1 ? 's' : ''} conditionnel{option.children.length > 1 ? 's' : ''}
                      </p>
                    )}
                  </li>
                )
              })}
            </ol>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setOptions([...node.options, newOption(`Option ${node.options.length + 1}`)])}>
              <PlusIcon data-icon="inline-start" />
              Ajouter une option
            </Button>
          </FieldSet>
        )}

        <Field aria-labelledby="prop-annex-title">
          <FieldTitle id="prop-annex-title">Annexe</FieldTitle>
          <AnnexPicker id="prop-annex" value={node.annex_ref?.annex_id ?? null} onChange={(annexId) => patch({ annex_ref: annexId ? { annex_id: annexId } : null })} />
          <FieldDescription>Une icône « i » suit alors le libellé&nbsp;: extrait au survol, PDF au clic.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="prop-move">Emplacement</FieldLabel>
          <Select value={here?.container} onValueChange={(container) => onChange(moveNode(tree, node.id, container, Infinity))}>
            <SelectTrigger id="prop-move" className="w-full" aria-describedby="prop-move-hint">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                {targets.map((c) => (
                  <SelectItem key={c.id} value={c.id} style={{ paddingLeft: `${0.375 + c.depth * 0.75}rem` }}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription id="prop-move-hint">Le champ passe à la fin de l'emplacement choisi (équivalent clavier du glisser-déposer).</FieldDescription>
        </Field>

        <AlertDialog open={!!removingOption} onOpenChange={(open) => !open && setRemovingOption(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer l'option « {removingOption?.label.trim() || 'Sans libellé'} »{'\u00a0'}?</AlertDialogTitle>
              <AlertDialogDescription>Ses champs conditionnels sont supprimés avec elle.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => isGroup(node) && removingOption && setOptions(node.options.filter((o) => o.id !== removingOption.id))}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {other.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
            {other.map((issue, i) => (
              <p key={i}>{issue.message}</p>
            ))}
          </div>
        )}
      </FieldGroup>
    </div>
  )
}
