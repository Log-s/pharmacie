import type { ReactNode } from 'react'
import { Paraphe } from '@/components/ProfileSwitcher'
import { isGroup, walk, type TemplateNode, type TemplateTree } from '@/templates/schema'
import { LabelText, OptionChildren } from './fields'
import { formatDate, nodeLabel, parseIsoDate, useProfiles, type Profile } from './helpers'
import type { FormValue } from './FormRenderer'
import { isEmpty, isSelected, type FormData } from './visibility'

/** The form's values as text: categories, selected options with their visible children, no inputs. */
export function ReadonlyView({ tree, value, headingLevel }: { tree: TemplateTree; value?: FormValue; headingLevel: number }) {
  const profiles = useProfiles([...walk(tree.nodes)].some((n) => n.type === 'author')).data
  return <NodeList nodes={tree.nodes} level={headingLevel} ctx={{ data: value?.data ?? {}, reference: value?.reference, profiles }} />
}

type Ctx = { data: FormData; reference?: string | null; profiles?: Profile[] }

// Runs of fields become one <dl>; categories are <section>s between them (a <dl> holds only dt/dd groups).
function NodeList({ nodes, level, ctx }: { nodes: TemplateNode[]; level: number; ctx: Ctx }) {
  const blocks: TemplateNode[][] = []
  for (const node of nodes) {
    const last = blocks.at(-1)
    if (node.type !== 'category' && last && last[0].type !== 'category') last.push(node)
    else blocks.push([node])
  }
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((block) =>
        block[0].type === 'category' ? (
          <Category key={block[0].id} node={block[0]} level={level} ctx={ctx} />
        ) : (
          <dl key={block[0].id} className="flex flex-col gap-4">
            {block.map((node) => (
              <div key={node.id} className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <LabelText node={{ ...node, required: false }} />
                </dt>
                <dd className="text-sm">
                  <Value node={node} level={level} ctx={ctx} />
                </dd>
              </div>
            ))}
          </dl>
        ),
      )}
    </div>
  )
}

function Category({ node, level, ctx }: { node: TemplateNode & { type: 'category' }; level: number; ctx: Ctx }) {
  const Tag = `h${Math.min(level, 6)}` as 'h2'
  return (
    <section className="flex flex-col gap-4 border-t pt-4 first:border-t-0 first:pt-0">
      <Tag className="flex items-center gap-1.5 text-base font-semibold text-balance">
        <LabelText node={{ ...node, required: false }} />
      </Tag>
      <NodeList nodes={node.children} level={level + 1} ctx={ctx} />
    </section>
  )
}

function Value({ node, level, ctx }: { node: TemplateNode; level: number; ctx: Ctx }): ReactNode {
  const empty = <span className="text-muted-foreground">Non renseigné</span>
  if (isGroup(node)) {
    const picked = node.options.filter((option) => isSelected(node, option, ctx.data))
    if (!picked.length) return empty
    return (
      <ul className="flex flex-col gap-3">
        {picked.map((option) => (
          <li key={option.id} className="flex flex-col gap-3">
            <span>{nodeLabel(option)}</span>
            {option.children.length > 0 && (
              <OptionChildren>
                <NodeList nodes={option.children} level={level + 1} ctx={ctx} />
              </OptionChildren>
            )}
          </li>
        ))}
      </ul>
    )
  }
  const raw = node.type === 'reference' ? ctx.reference : ctx.data[node.id]
  if (isEmpty(raw) || typeof raw !== 'string') return empty
  if (node.type === 'date') {
    const date = parseIsoDate(raw)
    return <span className="tabular-nums">{date ? formatDate(date) : raw}</span>
  }
  if (node.type === 'author') {
    const profile = ctx.profiles?.find((p) => p.id === raw)
    if (!profile) return ctx.profiles ? <span className="text-muted-foreground">Profil archivé</span> : null
    return (
      <span className="flex items-center gap-2">
        <Paraphe number={profile.number} color={profile.color} />
        {profile.display_name}
      </span>
    )
  }
  if (node.type === 'reference') return <span className="font-medium tabular-nums">{raw}</span>
  return <span className="whitespace-pre-wrap">{raw}</span>
}
