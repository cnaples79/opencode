import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createContext, createEffect, createMemo, useContext, type ParentProps } from "solid-js"
import { useSync } from "./sync"
import { uniqueBy } from "remeda"
import type { FileContent, FileNode } from "@opencode-ai/sdk"
import { useSDK } from "./sdk"

export type LocalFile = FileNode &
  Partial<{
    loaded: boolean
    pinned: boolean
    expanded: boolean
    content: FileContent
    selection: { startLine: number; startChar: number; endLine: number; endChar: number }
    scrollTop: number
    view: "raw" | "diff-unified" | "diff-split"
    folded: string[]
  }>
export type TextSelection = LocalFile["selection"]
export type View = LocalFile["view"]

function init() {
  const sdk = useSDK()
  const sync = useSync()

  const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent"))
  const agent = (() => {
    const [store, setStore] = createStore<{
      current: string
    }>({
      current: agents()[0].name,
    })
    return {
      current() {
        return agents().find((x) => x.name === store.current)!
      },
      move(direction: 1 | -1) {
        let next = agents().findIndex((x) => x.name === store.current) + direction
        if (next < 0) next = agents().length - 1
        if (next >= agents().length) next = 0
        const value = agents()[next]
        setStore("current", value.name)
        if (value.model)
          model.set({
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          })
      },
    }
  })()

  const model = (() => {
    const [store, setStore] = createStore<{
      model: Record<
        string,
        {
          providerID: string
          modelID: string
        }
      >
      recent: {
        providerID: string
        modelID: string
      }[]
    }>({
      model: {},
      recent: [],
    })

    const value = localStorage.getItem("model")
    setStore("recent", JSON.parse(value ?? "[]"))
    createEffect(() => {
      localStorage.setItem("model", JSON.stringify(store.recent))
    })

    const fallback = createMemo(() => {
      if (store.recent.length) return store.recent[0]
      const provider = sync.data.provider[0]
      const model = Object.values(provider.models)[0]
      return {
        providerID: provider.id,
        modelID: model.id,
      }
    })

    const current = createMemo(() => {
      const a = agent.current()
      return store.model[agent.current().name] ?? (a.model ? a.model : fallback())
    })

    return {
      current,
      recent() {
        return store.recent
      },
      parsed: createMemo(() => {
        const value = current()
        const provider = sync.data.provider.find((x) => x.id === value.providerID)!
        const model = provider.models[value.modelID]
        return {
          provider: provider.name ?? value.providerID,
          model: model.name ?? value.modelID,
        }
      }),
      set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
        batch(() => {
          setStore("model", agent.current().name, model)
          if (options?.recent) {
            const uniq = uniqueBy([model, ...store.recent], (x) => x.providerID + x.modelID)
            if (uniq.length > 5) uniq.pop()
            setStore("recent", uniq)
          }
        })
      },
    }
  })()

  const file = (() => {
    const [store, setStore] = createStore<{
      node: Record<string, LocalFile>
      opened: string[]
      active?: string
    }>({
      node: Object.fromEntries(sync.data.node.map((x) => [x.path, x])),
      opened: [],
    })

    const active = createMemo(() => {
      if (!store.active) return undefined
      return store.node[store.active]
    })
    const opened = createMemo(() => store.opened.map((x) => store.node[x]))

    const resetNode = (path: string) => {
      setStore("node", path, {
        loaded: undefined,
        pinned: undefined,
        content: undefined,
        selection: undefined,
        scrollTop: undefined,
        folded: undefined,
        view: undefined,
      })
    }

    const load = async (path: string) =>
      sdk.file.read({ query: { path } }).then((x) => {
        setStore(
          "node",
          path,
          produce((draft) => {
            draft.loaded = true
            draft.content = x.data
          }),
        )
      })

    const open = async (path: string) => {
      if (!store.node[path]) {
        const parent = path.split("/").slice(0, -1).join("/")
        if (parent) {
          await list(parent)
        }
      }
      setStore("opened", (x) => {
        if (x.includes(path)) return x
        return [
          ...opened()
            .filter((x) => x.pinned)
            .map((x) => x.path),
          path,
        ]
      })
      setStore("active", path)
      if (store.node[path].loaded) return
      return load(path)
    }

    const list = async (path: string) => {
      return sdk.file.list({ query: { path: path + "/" } }).then((x) => {
        setStore(
          "node",
          produce((draft) => {
            x.data!.forEach((node) => {
              if (node.path in draft) return
              draft[node.path] = node
            })
          }),
        )
      })
    }

    sdk.event.subscribe().then(async (events) => {
      for await (const event of events.stream) {
        switch (event.type) {
          case "message.part.updated":
            const part = event.properties.part
            if (part.type === "tool" && part.state.status === "completed") {
              switch (part.tool) {
                case "read":
                  console.log("read", part.state.input)
                  break
                case "edit":
                  const absolute = part.state.input["filePath"] as string
                  const path = absolute.replace(sync.data.path.directory + "/", "")
                  load(path)
                  break
                default:
                  break
              }
            }
            break
        }
      }
    })

    return {
      active,
      opened,
      node: (path: string) => store.node[path],
      update: (path: string, node: LocalFile) => setStore("node", path, reconcile(node)),
      open,
      load,
      close(path: string) {
        setStore("opened", (opened) => opened.filter((x) => x !== path))
        if (store.active === path) {
          const index = store.opened.findIndex((f) => f === path)
          const previous = store.opened[Math.max(0, index - 1)]
          setStore("active", previous)
        }
        resetNode(path)
      },
      expand(path: string) {
        setStore("node", path, "expanded", true)
        if (store.node[path].loaded) return
        setStore("node", path, "loaded", true)
        list(path)
      },
      collapse(path: string) {
        setStore("node", path, "expanded", false)
      },
      select(path: string, selection: TextSelection | undefined) {
        setStore("node", path, "selection", selection)
      },
      scroll(path: string, scrollTop: number) {
        setStore("node", path, "scrollTop", scrollTop)
      },
      move(path: string, to: number) {
        const index = store.opened.findIndex((f) => f === path)
        if (index === -1) return
        setStore(
          "opened",
          produce((opened) => {
            opened.splice(to, 0, opened.splice(index, 1)[0])
          }),
        )
        setStore("node", path, "pinned", true)
      },
      view(path: string): View {
        const n = store.node[path]
        return n && n.view ? n.view : "raw"
      },
      setView(path: string, view: View) {
        setStore("node", path, "view", view)
      },
      unfold(path: string, key: string) {
        setStore("node", path, "folded", (xs) => {
          const a = xs ?? []
          if (a.includes(key)) return a
          return [...a, key]
        })
      },
      fold(path: string, key: string) {
        setStore("node", path, "folded", (xs) => (xs ?? []).filter((k) => k !== key))
      },
      folded(path: string) {
        const n = store.node[path]
        return n && n.folded ? n.folded : []
      },
      children(path: string) {
        return Object.values(store.node).filter(
          (x) =>
            x.path.startsWith(path) &&
            x.path !== path &&
            !x.path.replace(new RegExp(`^${path + "/"}`), "").includes("/"),
        )
      },
    }
  })()

  const result = {
    model,
    agent,
    file,
  }
  return result
}

type LocalContext = ReturnType<typeof init>

const ctx = createContext<LocalContext>()

export function LocalProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useLocal() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useLocal must be used within a LocalProvider")
  }
  return value
}
