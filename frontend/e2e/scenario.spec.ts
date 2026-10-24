import { readFileSync } from 'node:fs'
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { tinyPdf } from './pdf.ts'

// Specification §11 « E2E Playwright », one serial scenario on a fresh production stack (scripts/e2e.sh
// has already run the non-interactive install). Admin and user keep their own browser context.
const baseURL = process.env.E2E_BASE_URL ?? 'https://localhost:18443'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ''
const USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? ''
const NEW_USER_PASSWORD = process.env.E2E_NEW_USER_PASSWORD ?? ''

const PROFILES = [
  { name: 'Camille Martin', initials: 'CM' },
  { name: 'Louis Durand', initials: 'LD' },
]
const ANNEX = { title: 'Protocole de dilution', excerpt: 'Diluer a 5 pour cent avant usage' }
const TEMPLATE = 'Contrôle des préparations'
const DETAIL = 'Flacon fendu au col'
const DETAIL_EDITED = 'Flacon fendu, écarté du stock'

let admin: Page
let user: Page
let userContext: BrowserContext
let reference = ''
let ficheUrl = ''

async function open(browser: Browser) {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true })
  return { context, page: await context.newPage() }
}

async function login(page: Page, role: 'Administrateur' | 'Utilisateur', password: string) {
  await page.goto('/connexion')
  await page.getByRole('radio', { name: role }).click()
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

const toast = (page: Page, text: string | RegExp) => expect(page.locator('[data-sonner-toast]').filter({ hasText: text })).toBeVisible()

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  admin = (await open(browser)).page
  const second = await open(browser)
  user = second.page
  userContext = second.context
})

test.afterAll(async () => {
  await admin.context().close()
  await userContext.close()
})

test('installation : l’instance répond et affiche la connexion', async () => {
  const health = await admin.request.get('/api/health')
  expect(health.status()).toBe(200)
  await admin.goto('/')
  await expect(admin).toHaveURL(/\/connexion$/)
  await expect(admin.getByRole('heading', { name: 'Connexion' })).toBeVisible()
})

test('admin : connexion, un mauvais mot de passe est refusé', async () => {
  await login(admin, 'Administrateur', `${ADMIN_PASSWORD}x`)
  await expect(admin.getByText('Connexion refusée')).toBeVisible()
  await login(admin, 'Administrateur', ADMIN_PASSWORD)
  await expect(admin).toHaveURL(/\/fiches$/)
  await expect(admin.getByText('Administrateur', { exact: true })).toBeVisible()
  await expect(admin).toHaveTitle('Fiches – Fiches de la pharmacie')
})

test('admin : crée deux profils', async () => {
  await admin.getByRole('link', { name: 'Profils' }).click()
  for (const { name, initials } of PROFILES) {
    await admin.getByRole('button', { name: 'Nouveau profil' }).click()
    const dialog = admin.getByRole('dialog', { name: 'Nouveau profil' })
    await dialog.getByLabel('Nom affiché').fill(name)
    await dialog.getByLabel('Initiales').fill(initials)
    await dialog.getByRole('radio', { name: name === PROFILES[0].name ? 'Vert' : 'Bleu' }).click()
    await dialog.getByRole('button', { name: 'Créer le profil' }).click()
    await toast(admin, 'Profil créé.')
    await expect(dialog).toBeHidden()
    await expect(admin.getByRole('row', { name: new RegExp(name) })).toBeVisible()
  }
})

test('admin : téléverse une annexe PDF', async () => {
  await admin.getByRole('link', { name: 'Annexes' }).click()
  await admin.getByLabel('Titre (facultatif)').fill(ANNEX.title)
  await admin.getByLabel('Fichier PDF').setInputFiles({ name: 'dilution.pdf', mimeType: 'application/pdf', buffer: tinyPdf(ANNEX.excerpt) })
  await toast(admin, `Annexe « ${ANNEX.title} » ajoutée.`)
  const item = admin.locator('main li').filter({ hasText: ANNEX.title })
  await expect(item).toContainText('dilution.pdf')
  await expect(item).toContainText(ANNEX.excerpt) // excerpt extracted from the PDF text
})

test('admin : crée un template avec sous-champ conditionnel et annexe, puis le publie', async () => {
  await admin.getByRole('link', { name: 'Templates' }).click()
  await admin.getByRole('link', { name: 'Nouveau template' }).click()
  await admin.getByLabel('Nom du template').fill(TEMPLATE)
  await admin.getByRole('button', { name: 'Créer le template' }).click()
  await expect(admin.getByRole('heading', { name: TEMPLATE, level: 1 })).toBeVisible()

  const add = async (menu: string | RegExp, type: string) => {
    await admin.getByRole('button', { name: menu }).click()
    await admin.getByRole('menuitem', { name: type }).click()
  }

  await add('Ajouter un champ dans Racine du template', 'Référence')

  await add('Ajouter un champ dans Racine du template', 'Cases à cocher')
  await admin.getByLabel('Libellé', { exact: true }).fill('Contrôles effectués')
  await admin.getByLabel("Libellé de l'option 1").fill('Conforme')
  await admin.getByLabel("Libellé de l'option 2").fill('Écart constaté')
  await admin.getByRole('button', { name: 'Lier une annexe' }).click()
  await admin.getByRole('button', { name: new RegExp(ANNEX.title) }).click()
  await expect(admin.getByText(ANNEX.title, { exact: true })).toBeVisible()

  // Conditional sub-field: only shown in the fiche when « Écart constaté » is ticked.
  await add(/^Ajouter un champ dans « Contrôles effectués » si « Écart constaté »$/, 'Texte')
  await admin.getByLabel('Libellé', { exact: true }).fill("Détail de l'écart")
  await admin.getByLabel('Champ obligatoire').check()

  const preview = admin.getByRole('region', { name: 'Aperçu de la fiche' })
  await expect(preview.getByRole('checkbox', { name: 'Écart constaté' })).toBeVisible()
  await expect(preview.getByLabel("Détail de l'écart")).toHaveCount(0)

  await admin.getByRole('button', { name: 'Publier la version 1' }).click()
  await toast(admin, /Version 1 publiée/)
  await expect(admin.getByText('À jour.')).toBeVisible()
})

test('utilisateur : connexion et choix du profil', async () => {
  await login(user, 'Utilisateur', USER_PASSWORD)
  await expect(user).toHaveURL(/\/profil$/)
  await user.getByRole('button', { name: new RegExp(PROFILES[0].name) }).click()
  await expect(user).toHaveURL(/\/fiches$/)
  await expect(user.getByRole('button', { name: `Profil actif : ${PROFILES[0].name}. Changer de profil` })).toBeVisible()
})

test('utilisateur : remplit une fiche, l’infobulle de l’annexe s’ouvre dans un nouvel onglet', async () => {
  await user.getByRole('link', { name: 'Nouvelle fiche' }).click()
  await user.getByRole('link', { name: new RegExp(TEMPLATE) }).click()
  await expect(user.getByLabel('Référence')).toHaveValue(/^FIXME-\d{6}$/)

  await user.getByRole('checkbox', { name: 'Conforme' }).check()
  await expect(user.getByLabel(/Détail de l'écart/)).toHaveCount(0)
  await user.getByRole('checkbox', { name: 'Écart constaté' }).check()
  await user.getByLabel(/Détail de l'écart/).fill(DETAIL)

  // Annex info: hover shows the excerpt, the link opens the PDF in a new tab.
  const info = user.getByRole('link', { name: 'Annexe : Contrôles effectués' })
  await info.hover()
  const card = user.getByRole('tooltip')
  await expect(card).toContainText(ANNEX.title)
  await expect(card).toContainText(ANNEX.excerpt)
  const [pdf, popup] = await Promise.all([
    userContext.waitForEvent('response', (r) => /\/api\/annexes\/[0-9a-f-]{36}\/file$/.test(r.url())),
    userContext.waitForEvent('page'),
    card.getByRole('link').click(),
  ])
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
  expect(new URL(pdf.url()).pathname).toMatch(/^\/api\/annexes\/[0-9a-f-]{36}\/file$/)
  expect((await (await userContext.request.get(pdf.url())).body()).subarray(0, 5).toString()).toBe('%PDF-')
  await popup.waitForLoadState()
  expect(new URL(popup.url()).pathname).toMatch(/^\/api\/annexes\/[0-9a-f-]{36}\/file$/)

  // Keyboard focus shows the same card.
  await popup.close()
  await user.bringToFront()
  await user.mouse.move(0, 0)
  await expect(user.getByRole('tooltip')).toHaveCount(0)
  await info.focus()
  await expect(user.getByRole('tooltip')).toContainText(ANNEX.excerpt)

  await user.getByRole('button', { name: 'Enregistrer' }).click()
  await toast(user, /Fiche FIXME-\d{6} créée\./)
  await expect(user).toHaveURL(/\/fiches\/[0-9a-f-]{36}$/)
  reference = (await user.getByRole('heading', { level: 1 }).innerText()).trim()
  expect(reference).toMatch(/^FIXME-\d{6}$/)
  ficheUrl = new URL(user.url()).pathname
  await expect(user.getByText(DETAIL)).toBeVisible()
})

test('utilisateur : exporte la fiche en PDF', async () => {
  const [download] = await Promise.all([user.waitForEvent('download'), user.getByRole('button', { name: 'Exporter en PDF' }).click()])
  expect(download.suggestedFilename()).toBe(`${reference}.pdf`)
  const path = await download.path()
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-')
})

test('utilisateur : en changeant de profil, la fiche de l’autre est en lecture seule', async () => {
  await expect(user.getByRole('button', { name: 'Modifier' }).or(user.getByRole('link', { name: 'Modifier' }))).toBeVisible() // owner
  await user.getByRole('button', { name: /^Profil actif : / }).click()
  await user.getByRole('menuitemradio', { name: PROFILES[1].name }).click()
  await toast(user, `Profil actif : ${PROFILES[1].name}`)

  await user.goto(ficheUrl)
  await expect(user.getByTestId('fiche-de')).toContainText(PROFILES[0].name)
  await expect(user.getByText('Lecture seule')).toBeVisible()
  await expect(user.getByRole('link', { name: 'Modifier' })).toHaveCount(0)
  await expect(user.getByRole('button', { name: 'Supprimer' })).toHaveCount(0)
  await expect(user.getByRole('button', { name: 'Exporter en PDF' })).toBeVisible()

  await user.goto(`${ficheUrl}/modifier`) // no right: sent back to the read-only view
  await expect(user).toHaveURL(new RegExp(`${ficheUrl}$`))
  await user.request.put(`/api/forms/${ficheUrl.split('/').pop()}`, { data: { reference, data: {} } }).then((r) => expect(r.status()).toBe(403))
})

test('admin : modifie puis supprime la fiche', async () => {
  await admin.getByRole('link', { name: 'Fiches', exact: true }).click()
  await admin.getByRole('link', { name: reference }).click()
  await expect(admin.getByText('Lecture seule')).toHaveCount(0) // the admin can edit
  await admin.getByRole('link', { name: 'Modifier' }).click()
  await admin.getByLabel(/Détail de l'écart/).fill(DETAIL_EDITED)
  await admin.getByRole('button', { name: 'Enregistrer' }).click()
  await toast(admin, `Fiche ${reference} enregistrée.`)
  await expect(admin.getByText(DETAIL_EDITED)).toBeVisible()

  await admin.getByRole('button', { name: 'Supprimer' }).click()
  await admin.getByRole('button', { name: 'Supprimer définitivement' }).click()
  await toast(admin, `Fiche ${reference} supprimée.`)
  await expect(admin).toHaveURL(/\/fiches$/)
  await expect(admin.getByText('Aucune fiche', { exact: true })).toBeVisible()

  await user.goto(ficheUrl)
  await expect(user.getByText('Fiche introuvable')).toBeVisible()
})

test('admin : réinitialise le mot de passe utilisateur, l’ancien est refusé', async () => {
  await admin.getByRole('link', { name: 'Compte utilisateur' }).click()
  await admin.getByLabel('Nouveau mot de passe').fill(NEW_USER_PASSWORD)
  await admin.getByLabel('Confirmation').fill(NEW_USER_PASSWORD)
  await admin.getByRole('button', { name: 'Définir le mot de passe' }).click()
  await toast(admin, 'Mot de passe du compte utilisateur modifié.')

  // The user's open session is closed by the reset.
  await user.goto('/fiches')
  await expect(user).toHaveURL(/\/connexion/)
  await login(user, 'Utilisateur', USER_PASSWORD)
  await expect(user.getByText('Connexion refusée')).toBeVisible()
  await login(user, 'Utilisateur', NEW_USER_PASSWORD)
  await expect(user).toHaveURL(/\/profil$/)
})
