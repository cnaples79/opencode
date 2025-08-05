import { For } from "solid-js"
import { useSync } from "@/context"
import { Icon, Link, Tooltip } from "@/ui"
import { useLocation } from "@solidjs/router"

export default function SessionList() {
  const location = useLocation()
  const sync = useSync()

  return (
    <nav class="p-2">
      <Link
        href="/sessions/new"
        variant="ghost"
        size="sm"
        class="text-xs text-text-muted/60 hover:text-text justify-start"
      >
        <Icon name="plus" class="mr-1" size={12} />
        Create New Session
      </Link>
      <For each={Object.values(sync.data.session)}>
        {(session) => (
          <Tooltip placement="right" value={session.title} class="w-full min-w-0">
            <Link
              href={`/sessions/${session.id}`}
              variant="ghost"
              size="sm"
              classList={{
                "w-full min-w-0 justify-start text-text-muted text-xs": true,
                "text-text!": location.pathname.endsWith(session.id),
              }}
            >
              <span class="truncate">{session.title}</span>
            </Link>
          </Tooltip>
        )}
      </For>
    </nav>
  )
}
