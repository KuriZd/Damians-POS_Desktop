import { useEffect, useState, type ReactElement } from 'react'
import LoginPage from './pages/LoginPage'
import AppLayout from './components/layout/AppLayout'

export default function App(): ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        if (!window.pos?.auth) {
          setCheckingSession(false)
          return
        }

        const me = await window.pos.auth.me()
        setUser(me)
      } catch {
        setUser(null)
      } finally {
        setCheckingSession(false)
      }
    })()
  }, [])

  if (checkingSession) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Arial, Helvetica, sans-serif',
          background: '#e6e6e6'
        }}
      >
        Cargando...
      </main>
    )
  }

  if (!user) {
    return <LoginPage onLoginSuccess={(loggedUser) => setUser(loggedUser)} />
  }

  return <AppLayout user={user} onLogout={() => setUser(null)} />
}
