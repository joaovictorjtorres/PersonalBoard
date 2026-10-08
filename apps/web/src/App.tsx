import { HomePage } from './ui/HomePage'
import { TablePage } from './ui/TablePage'

export function App() {
  const match = /^\/t\/([A-Za-z0-9]{10})\/?$/.exec(window.location.pathname)
  return match ? <TablePage tableId={match[1]} /> : <HomePage />
}
