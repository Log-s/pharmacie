import { useMutation } from '@tanstack/react-query'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { BoldIcon, Heading1Icon, Heading2Icon, Heading3Icon, ItalicIcon, LinkIcon, ListIcon, ListOrderedIcon, type LucideIcon, QuoteIcon, StrikethroughIcon, UnderlineIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { focusFirstInvalid } from '@/admin/validation'
import { PageHeader } from '@/components/PageHeader'
import { StatusPage } from '@/components/StatusPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { useUnsavedGuard } from '@/forms/useUnsavedGuard'
import { api, ApiError, queryClient } from '@/lib/api'
import { annexesKey, indexTree, pathLabel, useAnnexTree, useNote, type Note } from '@/annexes/api'

// Links are limited to what the server keeps (nh3 allowlist): http, https, mailto.
const SAFE_LINK = /^(https?:|mailto:)/i

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] }, // the server keeps h1-h3 only
    link: { openOnClick: false, autolink: true, protocols: ['mailto'], isAllowedUri: (url) => SAFE_LINK.test(url) },
  }),
]

/** `/annexes/notes/nouvelle?dossier=<id>` and `/annexes/notes/:id/modifier` (admin only). */
export default function NoteEditorPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const note = useNote(id)

  if (!id) return <NoteEditor key="new" folderId={params.get('dossier')} />
  if (note.isPending) return <Skeleton className="h-64 w-full max-w-3xl" aria-busy="true" aria-label="Chargement de la note…" />
  if (note.isError)
    return note.error instanceof ApiError && note.error.status === 404 ? (
      <StatusPage title="Note introuvable" description="Cette note n'existe pas ou a été supprimée." />
    ) : (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Note indisponible</AlertTitle>
        <AlertDescription>{note.error.message}</AlertDescription>
      </Alert>
    )
  return <NoteEditor key={note.data.id} note={note.data} folderId={note.data.folder_id} />
}

function NoteEditor({ note, folderId }: { note?: Note; folderId: string | null }) {
  const navigate = useNavigate()
  const tree = useAnnexTree()
  const where = useMemo(() => (tree.data ? pathLabel(indexTree(tree.data), folderId) : undefined), [tree.data, folderId])
  const [title, setTitle] = useState(note?.title ?? '')
  const [titleError, setTitleError] = useState<string>()
  const [general, setGeneral] = useState<string>()
  const [edited, setEdited] = useState(false) // body typed in; `onUpdate` does not fire for the initial content
  const editor = useEditor({
    extensions,
    content: note?.body_html ?? '',
    editorProps: { attributes: { class: 'note-content min-h-48 px-3 py-2 outline-none', 'aria-label': 'Contenu de la note', 'aria-multiline': 'true' } },
    onUpdate: () => setEdited(true),
  })
  const dirty = edited || title !== (note?.title ?? '')
  const { dialog, allowLeaving } = useUnsavedGuard(dirty)
  const cancelTo = note ? `/annexes/notes/${note.id}` : folderId ? `/annexes?dossier=${folderId}` : '/annexes'

  const mutation = useMutation({
    mutationFn: (body: { title: string; body_html: string }) =>
      note
        ? api<Note>(`/annexes/${note.id}`, { method: 'PATCH', json: body })
        : api<Note>('/annexes', { method: 'POST', json: folderId ? { ...body, folder_id: folderId } : body }),
    onMutate: () => setGeneral(undefined),
    onSuccess: (saved) => {
      allowLeaving()
      toast.success(note ? 'Note enregistrée.' : 'Note créée.')
      void queryClient.invalidateQueries({ queryKey: annexesKey })
      navigate(`/annexes/notes/${saved.id}`)
    },
    onError: (error) => setGeneral(error.message),
  })

  return (
    <>
      <PageHeader title={note ? 'Modifier la note' : 'Nouvelle note'} description={where && `Dossier\u00a0: ${where}`} />
      <form
        className="flex max-w-3xl flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!editor) return
          if (!title.trim()) {
            setTitleError('Saisissez un titre.')
            return focusFirstInvalid({ title: 'x' }, { title: 'note-title' })
          }
          mutation.mutate({ title: title.trim(), body_html: editor.getHTML() })
        }}
      >
        {general && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>La note n'a pas été enregistrée</AlertTitle>
            <AlertDescription>{general}</AlertDescription>
          </Alert>
        )}
        <Field data-invalid={!!titleError}>
          <FieldLabel htmlFor="note-title">Titre</FieldLabel>
          <Input
            id="note-title"
            name="title"
            value={title}
            maxLength={200}
            autoComplete="off"
            aria-invalid={!!titleError}
            aria-describedby={titleError ? 'note-title-error' : undefined}
            onChange={(event) => {
              setTitle(event.target.value)
              setTitleError(undefined)
            }}
          />
          {titleError && <FieldError id="note-title-error">{titleError}</FieldError>}
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Texte</span>
          {editor && <Toolbar editor={editor} />}
          <div className="min-w-0 rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <EditorContent editor={editor} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="submit" size="lg" disabled={mutation.isPending}>
            {mutation.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Link to={cancelTo} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            Annuler
          </Link>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {dirty && 'Modifications non enregistrées'}
          </p>
        </div>
      </form>
      {dialog}
    </>
  )
}

type Editor = NonNullable<ReturnType<typeof useEditor>>

function Toolbar({ editor }: { editor: Editor }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
    }),
  })
  const chain = () => editor.chain().focus()
  const items: [label: string, Icon: LucideIcon, pressed: boolean, run: () => void][] = [
    ['Gras', BoldIcon, on.bold, () => chain().toggleBold().run()],
    ['Italique', ItalicIcon, on.italic, () => chain().toggleItalic().run()],
    ['Souligné', UnderlineIcon, on.underline, () => chain().toggleUnderline().run()],
    ['Barré', StrikethroughIcon, on.strike, () => chain().toggleStrike().run()],
    ['Titre 1', Heading1Icon, on.h1, () => chain().toggleHeading({ level: 1 }).run()],
    ['Titre 2', Heading2Icon, on.h2, () => chain().toggleHeading({ level: 2 }).run()],
    ['Titre 3', Heading3Icon, on.h3, () => chain().toggleHeading({ level: 3 }).run()],
    ['Liste à puces', ListIcon, on.bullet, () => chain().toggleBulletList().run()],
    ['Liste numérotée', ListOrderedIcon, on.ordered, () => chain().toggleOrderedList().run()],
    ['Citation', QuoteIcon, on.quote, () => chain().toggleBlockquote().run()],
  ]
  return (
    <div role="toolbar" aria-label="Mise en forme" className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
      {items.map(([label, Icon, pressed, run]) => (
        <Toggle key={label} aria-label={label} title={label} pressed={pressed} onPressedChange={run}>
          <Icon />
        </Toggle>
      ))}
      <LinkToggle editor={editor} pressed={on.link} />
    </div>
  )
}

/** « Lien »: a small popover asks for the URL; an empty URL removes the link. */
function LinkToggle({ editor, pressed }: { editor: Editor; pressed: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')
  const [invalid, setInvalid] = useState(false)

  const apply = () => {
    const value = href.trim()
    const url = value && !SAFE_LINK.test(value) && !/^[a-z][a-z\d+.-]*:/i.test(value) ? `https://${value}` : value
    if (url && !SAFE_LINK.test(url)) return setInvalid(true)
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!url) chain.unsetLink().run()
    else if (editor.state.selection.empty && !pressed) chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    else chain.setLink({ href: url }).run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <Toggle
            aria-label="Lien"
            title="Lien"
            pressed={pressed}
            onPressedChange={() => {
              setHref(editor.getAttributes('link').href ?? '')
              setInvalid(false)
              setOpen(true)
            }}
          >
            <LinkIcon />
          </Toggle>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-80"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!editor.isDestroyed) editor.commands.focus()
        }}
      >
        <form
          className="flex flex-col gap-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation() // the portal sits inside the note form in the React tree
            apply()
          }}
        >
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor="note-link">Adresse du lien</FieldLabel>
            <Input
              id="note-link"
              name="href"
              type="url"
              inputMode="url"
              spellCheck={false}
              value={href}
              placeholder="https://…"
              autoComplete="off"
              aria-invalid={invalid}
              onChange={(event) => {
                setHref(event.target.value)
                setInvalid(false)
              }}
            />
            {invalid ? <FieldError>Seules les adresses http, https et mailto sont acceptées.</FieldError> : <p className="text-xs text-muted-foreground">Laissez vide pour retirer le lien.</p>}
          </Field>
          <Button type="submit" size="sm" className="self-end">
            Appliquer
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
