import { useSync } from "@/context"
import { Collapsible, Icon, type IconProps } from "@/ui"
import type { Part, ToolPart } from "@opencode-ai/sdk"
import { DateTime } from "luxon"
import { createMemo, Match, Switch, type ComponentProps, type ParentProps } from "solid-js"
import { Diff } from "./diff"
import { getFileExtension, getFilename } from "@/utils"
import Markdown from "./markdown"

function TimelineIcon(props: { name: IconProps["name"]; class?: string }) {
  return (
    <div
      classList={{
        "relative flex flex-none self-start items-center justify-center bg-background h-6 w-6": true,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <Icon name={props.name} class="text-text/40" size={18} />
    </div>
  )
}

function CollapsibleTimelineIcon(props: { name: IconProps["name"]; class?: string }) {
  return (
    <>
      <TimelineIcon
        name={props.name}
        class={`group-hover/li:hidden group-has-[[data-expanded]]/li:hidden ${props.class ?? ""}`}
      />
      <TimelineIcon
        name="chevron-right"
        class={`hidden group-hover/li:flex group-has-[[data-expanded]]/li:hidden ${props.class ?? ""}`}
      />
      <TimelineIcon name="chevron-down" class={`hidden group-has-[[data-expanded]]/li:flex ${props.class ?? ""}`} />
    </>
  )
}

function ToolIcon(props: { part: ToolPart }) {
  return (
    <Switch fallback={<TimelineIcon name="hammer" />}>
      <Match when={props.part.tool === "read"}>
        <CollapsibleTimelineIcon name="file" />
      </Match>
      <Match when={props.part.tool === "edit"}>
        <CollapsibleTimelineIcon name="pencil" />
      </Match>
      <Match when={props.part.tool === "write"}>
        <CollapsibleTimelineIcon name="file-plus" />
      </Match>
    </Switch>
  )
}

function CollapsiblePart(props: { title: ParentProps["children"] } & ParentProps & ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible {...props}>
      <Collapsible.Trigger class="peer/collapsible h-6">
        <p class="text-xs leading-4 text-left text-text-muted/60 font-medium">{props.title}</p>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p class="flex-auto py-1 text-xs min-w-0 text-pretty">
          <span class="text-text-muted/60 break-words">{props.children}</span>
        </p>
      </Collapsible.Content>
    </Collapsible>
  )
}

function ReadToolPart(props: { part: ToolPart }) {
  return (
    <Switch>
      <Match when={props.part.state.status === "completed" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            title={
              <>
                <span class="text-text-muted">Read</span> {getFilename(state().input["filePath"] as string)}
              </>
            }
          >
            <div class="p-2 bg-background-panel rounded-md border border-border-subtle"></div>
          </CollapsiblePart>
        )}
      </Match>
    </Switch>
  )
}

function EditToolPart(props: { part: ToolPart }) {
  return (
    <Switch>
      <Match when={props.part.state.status === "completed" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            defaultOpen
            title={
              <>
                <span class="text-text-muted">Edit</span> {getFilename(state().input["filePath"] as string)}
              </>
            }
          >
            <Diff
              lang={getFileExtension(state().input["filePath"] as string)}
              diff={state().metadata["diff"] as string}
            />
          </CollapsiblePart>
        )}
      </Match>
    </Switch>
  )
}

function WriteToolPart(props: { part: ToolPart }) {
  return (
    <Switch>
      <Match when={props.part.state.status === "completed" && props.part.state}>
        {(state) => (
          <CollapsiblePart
            title={
              <>
                <span class="text-text-muted">Write</span> {getFilename(state().input["filePath"] as string)}
              </>
            }
          >
            <div class="p-2 bg-background-panel rounded-md border border-border-subtle"></div>
          </CollapsiblePart>
        )}
      </Match>
    </Switch>
  )
}

function ToolPart(props: { part: ToolPart }) {
  return (
    <Switch
      fallback={
        <div class="flex-auto min-w-0 text-xs">
          {props.part.type}:{props.part.tool}
        </div>
      }
    >
      <Match when={props.part.tool === "read"}>
        <div class="min-w-0 flex-auto">
          <ReadToolPart part={props.part} />
        </div>
      </Match>
      <Match when={props.part.tool === "edit"}>
        <div class="min-w-0 flex-auto">
          <EditToolPart part={props.part} />
        </div>
      </Match>
      <Match when={props.part.tool === "write"}>
        <div class="min-w-0 flex-auto">
          <WriteToolPart part={props.part} />
        </div>
      </Match>
    </Switch>
  )
}

export default function SessionTimeline(props: { session: string; class?: string }) {
  const sync = useSync()

  const session = sync.data.session[props.session!]
  const messages = sync.data.message[props.session!]
  const all = Object.values(sync.data.part[props.session!]).flatMap((x) => Object.values(x))

  const parts = createMemo(() => {
    if (!messages) return []
    const valid = (part: Part) => {
      switch (part.type) {
        case "step-start":
        case "step-finish":
        case "file":
        case "patch":
          return false
        case "text":
          return !part.synthetic
        case "reasoning":
          return part.text.trim()
        default:
          return true
      }
    }
    const duration = (part: Part) => {
      switch (part.type) {
        default:
          if (
            "time" in part &&
            part.time &&
            "start" in part.time &&
            part.time.start &&
            "end" in part.time &&
            part.time.end
          ) {
            const start = DateTime.fromMillis(part.time.start)
            const end = DateTime.fromMillis(part.time.end)
            return end.diff(start).toFormat("s")
          }
          return ""
      }
    }

    return Object.values(messages).flatMap((message) =>
      all
        .filter((p) => p.messageID === message.id)
        .filter(valid)
        .map((p) => ({
          ...p,
          duration: duration(p),
          message,
        })),
    )
  })

  return (
    <div
      classList={{
        "p-4 space-y-4": true,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <h1 class="text-lg font-semibold text-text">{session.title ?? "No active session"}</h1>
      <ul role="list" class="space-y-3">
        {parts().map((part, partIndex) => (
          <li classList={{ "relative group/li flex gap-x-4 min-w-0 w-full": true }}>
            <div
              classList={{
                "absolute top-0 left-0 flex w-6 justify-center": true,
                "h-10": partIndex === parts.length - 1,
                "-bottom-10": partIndex !== parts.length - 1,
              }}
            >
              <div class="w-px bg-border-subtle" />
            </div>
            <Switch
              fallback={
                <div class="m-0.5 relative flex size-5 flex-none items-center justify-center bg-background">
                  <div class="size-1 rounded-full bg-text/10 ring ring-text/20" />
                </div>
              }
            >
              <Match when={part.type === "text"}>
                <Switch>
                  <Match when={part.message.role === "user"}>
                    <TimelineIcon name="avatar-square" />
                  </Match>
                  <Match when={part.message.role === "assistant"}>
                    <TimelineIcon name="sparkles" />
                  </Match>
                </Switch>
              </Match>
              <Match when={part.type === "reasoning"}>
                <CollapsibleTimelineIcon name="brain" />
              </Match>
              <Match when={part.type === "tool" && part}>{(part) => <ToolIcon part={part()} />}</Match>
            </Switch>
            <Switch fallback={<div class="flex-auto min-w-0 text-xs mt-1 text-left">{part.type}</div>}>
              <Match when={part.type === "text" && part}>
                {(part) => (
                  <Switch>
                    <Match when={part().message.role === "user"}>
                      <div class="w-full flex flex-col items-end justify-stretch gap-y-1.5 min-w-0">
                        <p class="w-full rounded-md p-3 ring-1 ring-text/15 ring-inset text-xs bg-background-panel">
                          <span class="font-medium text-text whitespace-pre-wrap break-words">{part().text}</span>
                        </p>
                        <p class="text-xs text-text-muted">12:07pm · adam</p>
                      </div>
                    </Match>
                    <Match when={part().message.role === "assistant"}>
                      <Markdown text={part().text} class="text-text" />
                    </Match>
                  </Switch>
                )}
              </Match>
              <Match when={part.type === "reasoning" && part}>
                {(part) => (
                  <CollapsiblePart
                    title={
                      <>
                        <span class="text-text-muted">Thought</span> for {part().duration}s
                      </>
                    }
                  >
                    <Markdown text={part().text} />
                  </CollapsiblePart>
                )}
              </Match>
              <Match when={part.type === "tool" && part}>{(part) => <ToolPart part={part()} />}</Match>
            </Switch>
          </li>
        ))}
      </ul>
    </div>
  )
}
