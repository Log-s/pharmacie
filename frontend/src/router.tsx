import { createBrowserRouter } from 'react-router'
import App from '@/App'

// Registration point: U3 replaces the placeholder with the app shell and module routes.
export const router = createBrowserRouter([{ path: '/', element: <App /> }])
