// src/renderer/src/pages/LoginPage.tsx
import { useState, type FormEvent, type ReactElement } from 'react'
import styles from './LoginPage.module.css'
import logo from '../assets/Logo.png'

type LoginPageProps = {
    onLoginSuccess: (user: AuthUser) => void
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps): ReactElement {
    /*
      Estado del formulario.
      Se mantiene local porque solo afecta a esta pantalla.
    */
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')

    /*
      Estado visual del flujo de login.
      - loading: desactiva inputs y botón mientras se valida
      - error: muestra errores de forma controlada
    */
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    /*
      Maneja el envío del formulario.
      La validación básica se hace aquí antes de pedirle al backend.
    */
    const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault()
        setError('')

        const normalizedUsername = username.trim()
        const normalizedPassword = password.trim()

        // Validación mínima local para evitar llamadas innecesarias.
        if (!normalizedUsername || !normalizedPassword) {
            setError('Ingresa usuario y contraseña')
            return
        }

        // Protección por si el bridge de Electron no estuviera disponible.
        if (!window.pos?.auth) {
            setError('Bridge de Electron no disponible')
            return
        }

        try {
            setLoading(true)

            // Llamada al backend expuesto por preload.
            const user = await window.pos.auth.login(normalizedUsername, normalizedPassword)

            // Si no regresó usuario, asumimos credenciales inválidas.
            if (!user) {
                setError('Credenciales inválidas')
                return
            }

            // Notificamos al contenedor principal que el login fue exitoso.
            onLoginSuccess(user)
        } catch {
            setError('Usuario o contraseña incorrectos')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className={styles.wrapper}>
            <div className={styles.card}>
                {/* Título principal de la papelería */}
                <h1 className={styles.title}>Papelería Damian</h1>

                {/* Logo corporativo */}
                <div className={styles.logoContainer}>
                    <img src={logo} alt="Logo Damian’s Papeleria" className={styles.logo} />
                </div>

                {/* Formulario principal de acceso */}
                <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
                    <input
                        type="text"
                        placeholder="usuario"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        className={styles.input}
                        disabled={loading}
                        autoComplete="username"
                    />

                    <input
                        type="password"
                        placeholder="contraseña"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={styles.input}
                        disabled={loading}
                        autoComplete="current-password"
                    />

                    {/* Mensaje de error del login */}
                    {error ? <p className={styles.error}>{error}</p> : null}

                    <button type="submit" className={styles.button} disabled={loading}>
                        {loading ? 'Ingresando...' : 'Iniciar Sesión'}
                    </button>
                </form>

                {/* Acción secundaria.
            Por ahora es visual, luego puede abrir recuperación o contacto admin. */}
                <button type="button" className={styles.forgotButton}>
                    ¿Olvidaste tu contraseña?
                </button>
            </div>
        </div>
    )
}