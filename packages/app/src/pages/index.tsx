import { FileIcon, Icon, IconButton, Tooltip } from "@/ui"
import { Tabs } from "@/ui/tabs"
import FileTree from "@/components/file-tree"
import { createRenderEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useLocal, useSDK, useSync } from "@/context"
import { Code } from "@/components/code"
import { getFileExtension, getFilename } from "@/utils"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  useDragDropContext,
} from "@thisbeyond/solid-dnd"
import type { DragEvent, Transformer } from "@thisbeyond/solid-dnd"
import type { LocalFile } from "@/context/local"

export default function Page() {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const [clickTimer, setClickTimer] = createSignal<number | undefined>()
  const [activeItem, setActiveItem] = createSignal<string | undefined>(undefined)
  const [inputValue, setInputValue] = createSignal("")
  const [codeReadyTick, setCodeReadyTick] = createSignal(0)
  let isProgrammaticSelection = false

  // TODO: remove
  local.model.set({ providerID: "opencode", modelID: "grok-code" })

  let inputRef: HTMLInputElement | undefined = undefined

  const MOD = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform) ? "Meta" : "Control"

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("selectionchange", handleSelectionChange)
    // Expose function globally for debugging/testing
    ;(window as any).openFileAndSelectLines = openFileAndSelectLines
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
    document.removeEventListener("selectionchange", handleSelectionChange)
  })

  // Sync native selection and scroll with store
  createRenderEffect(() => {
    codeReadyTick()

    const active = local.file.active()
    if (!active) return
    const node = local.file.node(active.path)

    const root = document.querySelector(`[data-source-file="${active.path}"]`) as HTMLElement | null
    if (root && node.scrollTop !== undefined && root.scrollTop !== node.scrollTop) {
      root.scrollTop = node.scrollTop
    }

    const codeEl = root?.querySelector("code") as HTMLElement | null
    const target = node.selection
    const current = getSelectionDetails()

    const matches = !!(
      target &&
      current &&
      current.fp === active.path &&
      current.sl === target.startLine &&
      current.sch === target.startChar &&
      current.el === target.endLine &&
      current.ech === target.endChar
    )

    if (!codeEl) return

    const sel = window.getSelection()
    if (!sel) return

    if (!target) {
      if (current && current.fp === active.path) {
        isProgrammaticSelection = true
        sel.removeAllRanges()
        queueMicrotask(() => {
          isProgrammaticSelection = false
        })
      }
      return
    }

    if (matches) return

    const lines = Array.from(codeEl.querySelectorAll(".line"))
    if (lines.length === 0) return

    let sIdx = Math.max(0, target.startLine - 1)
    let eIdx = Math.max(0, target.endLine - 1)
    let sChar = Math.max(0, target.startChar || 0)
    let eChar = Math.max(0, target.endChar || 0)

    if (sIdx > eIdx || (sIdx === eIdx && sChar > eChar)) {
      const ti = sIdx
      sIdx = eIdx
      eIdx = ti
      const tc = sChar
      sChar = eChar
      eChar = tc
    }

    if (eChar === 0 && eIdx > sIdx) {
      eIdx = eIdx - 1
      eChar = Number.POSITIVE_INFINITY
    }

    if (sIdx >= lines.length) return
    if (eIdx >= lines.length) eIdx = lines.length - 1

    const s = getNodeOffsetInLine(lines[sIdx], sChar) ?? { node: lines[sIdx], offset: 0 }
    const e = getNodeOffsetInLine(lines[eIdx], eChar) ?? {
      node: lines[eIdx],
      offset: lines[eIdx].childNodes.length,
    }

    const range = document.createRange()
    range.setStart(s.node, s.offset)
    range.setEnd(e.node, e.offset)

    isProgrammaticSelection = true
    sel.removeAllRanges()
    sel.addRange(range)
    queueMicrotask(() => {
      isProgrammaticSelection = false
    })
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    const inputFocused = document.activeElement === inputRef
    if (inputFocused) {
      if (e.key === "Escape") {
        inputRef?.blur()
      }
      return
    }

    if (local.file.active()) {
      if (e.getModifierState(MOD)) {
        if (e.key.toLowerCase() === "a") {
          e.preventDefault()
          selectAllInActiveCode()
          return
        }
        if (e.key.toLowerCase() === "c") {
          return
        }
      }
    }

    if (e.key.length === 1 && e.key !== "Unidentified") {
      inputRef?.focus()
    }
  }

  const handleSelectionChange = () => {
    if (isProgrammaticSelection) return
    const d = getSelectionDetails()
    if (!d) return
    const { fp, sl, sch, el, ech } = d
    const p = local.file.node(fp).selection
    if (p && p.startLine === sl && p.endLine === el && p.startChar === sch && p.endChar === ech) return
    local.file.select(fp, { startLine: sl, startChar: sch, endLine: el, endChar: ech })
  }

  const getSelectionDetails = () => {
    const s = window.getSelection()
    if (!s || s.rangeCount === 0) return null

    const r = s.getRangeAt(0)
    const sc = r.startContainer
    const ec = r.endContainer

    const getLineElement = (n: Node) =>
      (n.nodeType === Node.TEXT_NODE ? (n.parentElement as Element) : (n as Element))?.closest(".line")

    const sle = getLineElement(sc)
    const ele = getLineElement(ec)
    if (!sle || !ele) return null

    const sr = sle.closest("[data-source-file]") as HTMLElement | null
    const er = ele.closest("[data-source-file]") as HTMLElement | null
    if (!sr || sr !== er) return null

    const cc = sr.querySelector("code") as HTMLElement | null
    if (!cc) return null

    const lines = Array.from(cc.querySelectorAll(".line"))
    const sli = lines.indexOf(sle)
    const eli = lines.indexOf(ele)
    if (sli === -1 || eli === -1) return null

    const fp = sr.getAttribute("data-source-file") || local.file.active()!.path
    const sl = sli + 1
    const el = eli + 1
    const sch = getCharacterOffsetInLine(sle, sc, r.startOffset)
    const ech = getCharacterOffsetInLine(ele, ec, r.endOffset)

    return { fp, sl, sch, el, ech, cc }
  }

  function selectAllInActiveCode() {
    const active = local.file.active()
    if (!active) return

    const root = document.querySelector(`[data-source-file="${active.path}"]`) as HTMLElement | null
    if (!root) return
    const element = root.querySelector("code") as HTMLElement | null
    if (!element) return

    const lines = Array.from(element.querySelectorAll(".line"))
    if (!lines.length) return

    const r = document.createRange()
    const last = lines[lines.length - 1]
    r.selectNodeContents(last)
    const lastLen = r.toString().length

    const selection = { startLine: 1, startChar: 0, endLine: lines.length, endChar: lastLen }
    local.file.select(active.path, selection)
  }

  const getCharacterOffsetInLine = (lineElement: Element, targetNode: Node, offset: number): number => {
    const r = document.createRange()
    r.selectNodeContents(lineElement)
    r.setEnd(targetNode, offset)
    return r.toString().length
  }

  const getNodeOffsetInLine = (lineElement: Element, charIndex: number): { node: Node; offset: number } | null => {
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null)
    let remaining = Math.max(0, charIndex)
    let lastText: Node | null = null
    let lastLen = 0
    let node: Node | null
    while ((node = walker.nextNode())) {
      const len = node.textContent?.length || 0
      lastText = node
      lastLen = len
      if (remaining <= len) return { node, offset: remaining }
      remaining -= len
    }
    if (lastText) return { node: lastText, offset: lastLen }
    if (lineElement.firstChild) return { node: lineElement.firstChild, offset: 0 }
    return null
  }

  const handleCodeReady = () => {
    setCodeReadyTick((x) => x + 1)
  }

  const handleCodeScrollEnd = (file: LocalFile, element: HTMLElement) => {
    if (local.file.active()?.path !== file.path) return
    local.file.scroll(file.path, element.scrollTop)
  }

  const openFileAndSelectLines = async (pathWithLines: string) => {
    // Parse format like "src/file.tsx:L10-32"
    const match = pathWithLines.match(/^(.+):L(\d+)-(\d+)$/)
    if (!match) {
      console.error(`Invalid format: ${pathWithLines}. Expected format: <path>:L<start>-<end>`)
      return
    }

    const [, filePath, startLine, endLine] = match
    const selection = {
      startLine: parseInt(startLine, 10),
      startChar: 0,
      endLine: parseInt(endLine, 10) + 1,
      endChar: 0,
    }
    local.file.open(filePath)
    local.file.select(filePath, selection)
  }

  const resetClickTimer = () => {
    if (!clickTimer()) return
    clearTimeout(clickTimer())
    setClickTimer(undefined)
  }

  const startClickTimer = () => {
    const newClickTimer = setTimeout(() => {
      setClickTimer(undefined)
    }, 300)
    setClickTimer(newClickTimer as unknown as number)
  }

  const handleFileClick = async (file: LocalFile) => {
    if (clickTimer()) {
      resetClickTimer()
      local.file.update(file.path, { ...file, pinned: true })
    } else {
      local.file.open(file.path)
      startClickTimer()
    }
  }

  const handleTabChange = (path: string) => {
    local.file.open(path)
  }

  const handleTabClose = (file: LocalFile) => {
    local.file.close(file.path)
  }

  const onDragStart = (event: any) => {
    setActiveItem(event.draggable.id as string)
  }

  const onDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const currentFiles = local.file.opened().map((f) => f.path)
      const fromIndex = currentFiles.indexOf(draggable.id.toString())
      const toIndex = currentFiles.indexOf(droppable.id.toString())
      if (fromIndex !== toIndex) {
        local.file.move(draggable.id.toString(), toIndex)
      }
    }
  }

  const onDragEnd = () => {
    setActiveItem(undefined)
  }

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault()
    const prompt = inputValue()
    setInputValue("")
    inputRef?.blur()

    const session = await sdk.session.create()
    const response = await sdk.session.prompt({
      path: { id: session.data!.id },
      body: {
        agent: local.agent.current()!.name,
        model: local.model.current(),
        parts: [
          {
            type: "text",
            text: prompt,
          },
          ...local.file
            .opened()
            .filter((f) => f.selection || local.file.active()?.path === f.path)
            .flatMap((f) => [
              {
                type: "file" as const,
                mime: "text/plain",
                url: `file://${f.absolute}${f.selection ? `?start=${f.selection.startLine}&end=${f.selection.endLine}` : ""}`,
                filename: f.name,
                source: {
                  type: "file" as const,
                  text: {
                    value: "@" + f.name,
                    start: 0, // f.start,
                    end: 0, // f.end,
                  },
                  path: f.absolute,
                },
              },
            ]),
        ],
      },
    })

    console.log("response", response)
  }

  return (
    <div class="relative">
      <div class="fixed top-0 w-50 h-full border-r border-border-subtle/30 flex flex-col overflow-hidden">
        <div class="p-1 bg-background-element">
          <div class="py-1 text-[10px] uppercase text-text-muted/60 tracking-wider font-light">modified files</div>
          <For each={sync.data.file}>
            {(f) => (
              <div
                class="w-full py-0.5 flex items-center gap-x-1.5 hover:bg-background-panel cursor-pointer"
                onClick={() => local.file.open(f.path)}
              >
                <FileIcon node={{ path: f.path, type: "file" }} class="text-primary" />
                <div class="grow flex items-center justify-between">
                  <div
                    classList={{
                      "text-xs whitepace-nowrap truncate": true,
                      "text-warning/60": f.status === "modified",
                      "text-success/60": f.status === "added",
                      "text-error/60": f.status === "deleted",
                    }}
                  >
                    {getFilename(f.path)}
                  </div>
                  <Switch>
                    <Match when={f.status === "modified"}>
                      <div class="w-3 text-center text-xs text-warning/60 font-light">M</div>
                    </Match>
                    <Match when={f.status === "added"}>
                      <div class="w-3 text-center text-xs text-success/60 font-light">A</div>
                    </Match>
                    <Match when={f.status === "deleted"}>
                      <div class="w-3 text-center text-xs text-error/60 font-light">D</div>
                    </Match>
                  </Switch>
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="relative flex-1 py-2 min-h-0 overflow-y-auto no-scrollbar">
          <FileTree path="" onFileClick={handleFileClick} />
          <div
            class="hidden pointer-events-none absolute top-0 left-0 right-0 h-4 
                 bg-gradient-to-t from-transparent to-background"
          />
          <div
            class="hidden pointer-events-none absolute bottom-0 left-0 right-0 h-4
                 bg-gradient-to-b from-transparent to-background"
          />
        </div>
      </div>
      <div class="pl-50">
        <DragDropProvider
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragYAxis />
          <Tabs
            class="relative grow w-full flex flex-col h-screen"
            value={local.file.active()?.path}
            onChange={handleTabChange}
          >
            <div class="sticky top-0 shrink-0 flex">
              <Tabs.List class="grow">
                <SortableProvider ids={local.file.opened().map((f) => f.path)}>
                  <For each={local.file.opened()}>
                    {(file) => <SortableTab file={file} onTabClick={handleFileClick} onTabClose={handleTabClose} />}
                  </For>
                </SortableProvider>
              </Tabs.List>
              <div class="shrink-0 h-full flex items-center gap-1 px-2 border-b border-border-subtle/40">
                <Show when={local.file.active() && local.file.active()!.content?.diff}>
                  {(() => {
                    const f = local.file.active()!
                    const view = local.file.view(f.path)
                    return (
                      <div class="flex items-center gap-1">
                        <Tooltip value="Raw" placement="bottom">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            classList={{
                              "text-text": view === "raw",
                              "text-text-muted/70": view !== "raw",
                              "bg-background-element": view === "raw",
                            }}
                            onClick={() => local.file.setView(f.path, "raw")}
                          >
                            <Icon name="file-text" size={14} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip value="Unified diff" placement="bottom">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            classList={{
                              "text-text": view === "diff-unified",
                              "text-text-muted/70": view !== "diff-unified",
                              "bg-background-element": view === "diff-unified",
                            }}
                            onClick={() => local.file.setView(f.path, "diff-unified")}
                          >
                            <Icon name="checklist" size={14} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip value="Split diff" placement="bottom">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            classList={{
                              "text-text": view === "diff-split",
                              "text-text-muted/70": view !== "diff-split",
                              "bg-background-element": view === "diff-split",
                            }}
                            onClick={() => local.file.setView(f.path, "diff-split")}
                          >
                            <Icon name="columns" size={14} />
                          </IconButton>
                        </Tooltip>
                      </div>
                    )
                  })()}
                </Show>
              </div>
            </div>
            <For each={local.file.opened()}>
              {(file) => (
                <Tabs.Content value={file.path} class="grow h-full pt-1 select-text">
                  {(() => {
                    const view = local.file.view(file.path)
                    const showRaw = view === "raw" || !file.content?.diff
                    const code = showRaw ? (file.content?.content ?? "") : (file.content?.diff ?? "")
                    return (
                      <Code
                        data-source-file={file.path}
                        lang={getFileExtension(file.path)}
                        code={code}
                        onReady={handleCodeReady}
                        onScrollEnd={(e) => handleCodeScrollEnd(file, e.currentTarget)}
                      />
                    )
                  })()}
                </Tabs.Content>
              )}
            </For>
          </Tabs>
          <DragOverlay>
            {activeItem() &&
              (() => {
                const draggedFile = local.file.node(activeItem()!)
                return (
                  <div
                    class="relative px-3 h-9 flex items-center 
                           text-sm font-medium text-text whitespace-nowrap
                           shrink-0 bg-background-panel 
                           border-x border-border-subtle/40 border-b border-b-transparent"
                  >
                    <TabVisual file={draggedFile} />
                  </div>
                )
              })()}
          </DragOverlay>
        </DragDropProvider>
        <form
          onSubmit={handleSubmit}
          class="peer/editor absolute left-60 right-10 bottom-8 z-50 flex items-center justify-center"
        >
          <div
            class="w-full max-w-2xl min-w-1/2 p-2 mx-auto rounded-lg isolate backdrop-blur-xs
                   flex flex-col gap-1
                   bg-gradient-to-b from-background-panel/90 to-background/90
                   ring-1 ring-border-active/50 border border-transparent
                   shadow-[0_0_33px_rgba(0,0,0,0.8)]
                   focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary"
          >
            <div class="flex flex-wrap gap-1">
              <Show when={local.file.active()}>
                <FileTag
                  default
                  file={local.file.active()!}
                  onClose={() => local.file.close(local.file.active()?.path ?? "")}
                />
              </Show>
              <For each={local.file.opened().filter((x) => x.selection)}>
                {(file) => <FileTag file={file} onClose={() => local.file.select(file.path, undefined)} />}
              </For>
            </div>
            <input
              ref={(el) => (inputRef = el)}
              type="text"
              value={inputValue()}
              onInput={(e) => setInputValue(e.currentTarget.value)}
              placeholder="It all starts with a prompt..."
              class="w-full p-1 pb-4 text-text font-light placeholder-text-muted/70 text-sm focus:outline-none"
            />
            <div class="px-1 flex justify-between items-center text-xs text-text-muted">
              <span>
                <span class="text-primary uppercase">{local.agent.current()?.name ?? "unknown"}</span> /{" "}
                {local.model.parsed().provider} / {local.model.parsed().model}
              </span>
              <div class="flex gap-1 items-center">
                <IconButton class="text-text-muted" size="xs" variant="ghost">
                  <Icon name="photo" size={16} />
                </IconButton>
                <IconButton class="text-background-panel! bg-primary rounded-full!" size="xs" variant="ghost">
                  <Icon name="arrow-up" size={14} />
                </IconButton>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

const TabVisual = (props: { file: LocalFile }) => (
  <div class="flex items-center gap-x-1.5">
    <FileIcon node={props.file} class="" />
    <span classList={{ "text-xs": true, italic: !props.file.pinned }}>{props.file.name}</span>
  </div>
)

const SortableTab = (props: {
  file: LocalFile
  onTabClick: (file: LocalFile) => void
  onTabClose: (file: LocalFile) => void
}) => {
  const sortable = createSortable(props.file.path)

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <Tooltip value={props.file.path} placement="bottom">
        <div class="relative">
          <Tabs.Trigger value={props.file.path} class="peer/tab pr-7" onClick={() => props.onTabClick(props.file)}>
            <TabVisual file={props.file} />
          </Tabs.Trigger>
          <IconButton
            class="absolute right-1 top-2 opacity-0 text-text-muted/60
                   peer-data-[selected]/tab:opacity-100 peer-data-[selected]/tab:text-text
                   peer-data-[selected]/tab:hover:bg-border-subtle
                   hover:opacity-100 peer-hover/tab:opacity-100"
            size="xs"
            variant="ghost"
            onClick={() => props.onTabClose(props.file)}
          >
            <Icon name="close" size={16} />
          </IconButton>
        </div>
      </Tooltip>
    </div>
  )
}

const FileTag = (props: { file: LocalFile; default?: boolean; onClose: () => void }) => (
  <div
    class="flex items-center bg-background group/tag
           border border-border-subtle/60 border-dashed
           rounded-md text-xs text-text-muted"
  >
    <IconButton class="text-text-muted" size="xs" variant="ghost" onClick={props.onClose}>
      <Switch fallback={<FileIcon node={props.file} class="group-hover/tag:hidden size-3!" />}>
        <Match when={props.default}>
          <Icon name="file" class="group-hover/tag:hidden" size={12} />
        </Match>
      </Switch>
      <Icon name="close" class="hidden group-hover/tag:block" size={12} />
    </IconButton>
    <div class="pr-1 flex gap-1 items-center">
      <span>{props.file.name}</span>
      <Show when={!props.default && props.file.selection}>
        <span class="">
          ({props.file.selection!.startLine}-{props.file.selection!.endLine})
        </span>
      </Show>
    </div>
  </div>
)

const ConstrainDragYAxis = () => {
  const context = useDragDropContext()
  if (!context) return <></>
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = {
    id: "constrain-y-axis",
    order: 100,
    callback: (transform) => ({ ...transform, y: 0 }),
  }
  onDragStart((event: any) => {
    addTransformer("draggables", event.draggable.id, transformer)
  })
  onDragEnd((event: any) => {
    removeTransformer("draggables", event.draggable.id, transformer.id)
  })
  return <></>
}
