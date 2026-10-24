import { createBrowserRouter } from 'react-router'
import App from '@/App'

// Registration point: U3 replaces the placeholder with the app shell, module routes and a 404 page.
export const router = createBrowserRouter([{ path: '*', element: <App /> }])
