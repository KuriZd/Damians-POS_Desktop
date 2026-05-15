import { type ReactElement } from 'react'
import styles from './ModulePlaceholderPage.module.css'

type ModulePlaceholderPageProps = {
  title: string
  description: string
  items: string[]
}

export default function ModulePlaceholderPage({
  title,
  description,
  items
}: ModulePlaceholderPageProps): ReactElement {
  return (
    <section className={styles.page}>
      <article className={styles.heroCard}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.description}>{description}</p>
      </article>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h3 className={styles.cardTitle}>Estado del módulo</h3>
          <p className={styles.cardText}>
            Esta es una versión base del módulo. La estructura ya está lista para que después
            agregues lógica real, tablas, formularios y acciones.
          </p>
        </article>

        <article className={styles.card}>
          <h3 className={styles.cardTitle}>Próximas funciones</h3>

          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item} className={styles.listItem}>
                {item}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </section>
  )
}
