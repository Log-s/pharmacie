import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import App from '@/App'
import JournalPage from '@/admin/JournalPage'
import UserAccountPage from '@/admin/UserAccountPage'
import AnnexesPage from '@/annexes/AnnexesPage'
import { RequireAuth, RequireProfile, RequireRole } from '@/auth/guards'
import LoginPage from '@/auth/LoginPage'
import { StatusPage } from '@/components/StatusPage'
import FormEditPage from '@/forms/FormEditPage'
import FormNewPage from '@/forms/FormNewPage'
import FormsListPage from '@/forms/FormsListPage'
import FormViewPage from '@/forms/FormViewPage'
import ProfilePickerPage from '@/profiles/ProfilePickerPage'
import ProfilesPage from '@/profiles/ProfilesPage'
import TemplateEditorPage from '@/templates/TemplateEditorPage'
import TemplatesPage from '@/templates/TemplatesPage'

// Registration point. Module units fill their page component; the paths and guards stay here.
// Guards are UI mirrors only: the API enforces the same rules (backend/app/api/deps.py).
export const routes: RouteObject[] = [
  { path: '/connexion', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <App />,
        children: [
          { index: true, element: <Navigate to="/fiches" replace /> },
          // User account only.
          { element: <RequireRole allow="user" />, children: [{ path: 'profil', element: <ProfilePickerPage /> }] },
          // Both roles; the user account needs an active profile first.
          {
            element: <RequireProfile />,
            children: [
              { path: 'fiches', element: <FormsListPage /> },
              { element: <RequireRole allow="user" />, children: [{ path: 'fiches/nouvelle', element: <FormNewPage /> }] },
              { path: 'fiches/:formId', element: <FormViewPage /> },
              { path: 'fiches/:formId/modifier', element: <FormEditPage /> },
              { path: 'annexes', element: <AnnexesPage /> },
            ],
          },
          // Admin only.
          {
            element: <RequireRole allow="admin" />,
            children: [
              { path: 'profils', element: <ProfilesPage /> },
              { path: 'templates', element: <TemplatesPage /> },
              { path: 'templates/nouveau', element: <TemplateEditorPage /> },
              { path: 'templates/:templateId', element: <TemplateEditorPage /> },
              { path: 'journal', element: <JournalPage /> },
              { path: 'compte-utilisateur', element: <UserAccountPage /> },
            ],
          },
          { path: '*', element: <StatusPage title="Page introuvable" description="Cette adresse ne correspond à aucune page." /> },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
