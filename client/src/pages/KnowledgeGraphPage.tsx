import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { Button, EmptyState } from '@/components/ui'
import { useDatabase } from '@/contexts/DatabaseContext'
import { getGraphStats } from '@/services/insights'
import { getVaultDisplayName } from '@/services/vaultHandle'

type GraphStats = ReturnType<typeof getGraphStats>

function countLine(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function StatColumn({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<{ label: string; count: number }>
  empty: string
}) {
  return (
    <section className="border-t border-b border-gray-200 dark:border-gray-800 py-5">
      <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-4">{title}</h2>
      {rows.length > 0 ? (
        <dl className="space-y-3">
          {rows.map(row => (
            <div key={row.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm font-medium text-gray-700 dark:text-gray-300">{row.label}</dt>
              <dd className="font-serif italic text-xl text-gray-950 dark:text-white">{row.count}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
      )}
    </section>
  )
}

function StatsBlock({ stats }: { stats: GraphStats }) {
  if (stats.verifiedTotal === 0) {
    return (
      <EmptyState
        kicker="Graph"
        message="No verified insights are ready for the graph yet."
        action={<Link to="/app/topics/new" className="btn-primary inline-block">Create your first topic</Link>}
      />
    )
  }

  return (
    <section className="mt-12">
      <div className="mb-6 border-t border-gray-200 dark:border-gray-800 pt-5">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {countLine(stats.verifiedTotal, 'verified insight')} · {countLine(stats.topicTotal, 'topic')}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <StatColumn
          title="Insight kinds"
          rows={stats.byKind.map(item => ({ label: item.label, count: item.count }))}
          empty="No kind data yet."
        />
        <StatColumn
          title="Topics by size"
          rows={stats.topicSizes.map(item => ({ label: item.title, count: item.count }))}
          empty="No topic links yet."
        />
      </div>
    </section>
  )
}

export default function KnowledgeGraphPage() {
  const db = useDatabase()
  const stats = useMemo(() => getGraphStats(db), [db])
  const [vaultName, setVaultName] = useState<string | null>(null)
  const [isLoadingVault, setIsLoadingVault] = useState(true)

  useEffect(() => {
    let active = true
    getVaultDisplayName()
      .then(name => {
        if (active) setVaultName(name)
      })
      .catch(error => {
        console.warn('[me.md:graph] Could not read persisted vault handle', error)
        if (active) setVaultName(null)
      })
      .finally(() => {
        if (active) setIsLoadingVault(false)
      })
    return () => {
      active = false
    }
  }, [])

  const openIndex = () => {
    if (!vaultName) return
    const vault = encodeURIComponent(vaultName)
    const file = encodeURIComponent('me.md/Me - Index')
    window.location.href = `obsidian://open?vault=${vault}&file=${file}`
  }

  if (isLoadingVault) {
    return (
      <div className="py-16">
        <LoadingSpinner size="lg" message="Loading graph…" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <header className="border-b border-gray-200 dark:border-gray-800 pb-8">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">Explore</p>
        <h1 className="font-serif italic font-medium text-4xl sm:text-5xl text-gray-950 dark:text-white">
          Graph
        </h1>
      </header>

      {vaultName ? (
        <section className="py-10 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-serif italic text-2xl text-gray-950 dark:text-white mb-4">
            Your graph lives in Obsidian
          </h2>
          <p className="max-w-2xl text-base leading-7 text-gray-600 dark:text-gray-300 mb-6">
            Every verified insight is a note in your vault, linked to its topic and the index.
            Obsidian&apos;s graph view draws the picture from those links, using the notes you can inspect.
          </p>
          <Button onClick={openIndex}>Open Me - Index in Obsidian</Button>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            If the button does not resolve, open Obsidian and go to me.md/Me - Index.
          </p>
        </section>
      ) : (
        <section className="py-10 border-b border-gray-200 dark:border-gray-800">
          <p className="max-w-2xl text-base leading-7 text-gray-600 dark:text-gray-300 mb-5">
            Connect an Obsidian vault from the Export page to see these links in Obsidian&apos;s graph view.
          </p>
          <Link to="/app/export" className="btn-primary inline-block">Go to Export</Link>
        </section>
      )}

      <StatsBlock stats={stats} />
    </div>
  )
}
