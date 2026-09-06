# DIF Explorer — Разведка (Step 1)

Плагин `ui-dif-explorer`: read-only просмотрщик файлов, правок и диффов workspace.
Все выводы проверены по коду репозитория на ветке `feat/dif-explorer` (база `master`).

## 1. Анатомия клиентского плагина (образцы: ui-trajectory, ui-deliverables)

Обязательные файлы пакета `packages/client/ui-<name>/`:

| Файл | Роль |
|---|---|
| `package.json` | имя `@deepseek-ai/dsh-client-ui-<name>`; exports `.`, `./invariant`, `./client`, `./src/*`, `./package.json`; блок `dsh.client` (manifest: `platform: 'web'`, `inject` — информационные edges); `files` покрывает lib-артефакты |
| `tsconfig.json` | extends `packages/client/tsconfig.base.client.json`; `rootDir: src`; references = каждому workspace-dep + `runtime-diagnostics/invariants` |
| `tsdown.config.ts` | `clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])` из `../tsdown.client.ts` |
| `src/index.ts` | node-half apply (обычно пустой) — Loader entry |
| `src/invariant.ts` | компаньон через `ctx.invariants.register(PACKAGE_NAME, install)`; для плагина без собственных мутабельных состояний — обоснованное «No runtime invariant» + причина |
| `src/css-modules.d.ts` | когда используются CSS Modules |
| `src/client/index.ts` | браузерная половина; единственный публичный API — `inject`/`apply` (+ контракты типов) |

Регистрация UI в slottого систему (проверено на ui-trajectory): браузерный apply делает
`ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id, order, locale: NS, label: () => t(...), inject }, Component))`.
Слот `conversation.view` (kind list, scope session) — ринг вкладок тела сессии (Chat / Trajectory);
DIF Explorer встаёт туда одной вкладкой со своими внутренними подвкладками Files/Changes/History.

Три обязательные поверхности регистрации нового пакета (из packages/client/AGENTS.md):
1. reference в агрегате `tsconfig.client.json`;
2. строка ростера `- id: ui-dif-explorer → @deepseek-ai/dsh-client-ui-dif-explorer` в `packages/bundle/web-app/cordis.patch.yml` (browser roster секция);
3. dependency в `packages/bundle/web-app/package.json` (боров резолвит bare-row имена через профили node_modules).

## 2. Ростер браузерных плагинов

`packages/bundle/web-app/cordis.patch.yml`: строки `- insert:` с `id`/`name` — это и host-side ряды,
и browser roster (`dsh.client`-ряды сканируются node-полоской client-modules в `window.__DSH_BOOT__`).
UI-ряды лежат в секции «browser plugin roster». Патч **заменяет целиком** config целевой строки.

## 3. HMR

`packages/client/hmr/README.md`: цепочка смонтирована всегда (`client-hmr`), но простаивает без
watcher'а. При живом `pnpm run dev:web` (tsdown watch переписывает `lib/client.js`) node-половка
stat-poll'ом замечает rev-change и шлёт SSE `GET /plugins/events` (кадр `rebuilt`);
браузерная половинка последовательно invalidate → prefetch → registry.delete → drain fiber →
refresh (re-import/remount). React state внутри перезагруженного плагина теряется, слой данных сохраняется.
Новый пакет подхватывается существующим механизмом без какого-либо кода с моей стороны.
ВАЖНО: сборка браузерной половины живого плагина идёт из `lib/types/client/index.js` → перед проверкой
делать `pnpm --filter <pkg> bundle` (или держать watcher).

## 4. RPC (@Remote / Typert)

- Сервисная сторона: класс extends `TypertRemoteService` (`@deepseek-ai/dsh-typert-protocol`),
  конструктор `super(ctx, '<namespace>')`, методы `@Remote('<method>')`.
  Примеры: `PluginInventoryGateway.list()` (packages/host/plugin-inventory/src/index.ts),
  `MessageFeedbackService` put/list/delete (packages/feedback/message-feedback),
  `SessionReferenceGateway.candidates()` (packages/context/session-reference).
- Монтаж: **явный список** в `packages/api/remotes/src/client/index.ts` — импорт `<pkg>/remote`,
  `ctx.remote.$mount(contribution)` и type-only re-export declaration merge'ей; payload-типы
  реэкспортируются отсюда же. Клиентский вызов: `ctx.remote.difExplorer.method(args)` c inject ['remote', 'remote.difExplorer'].
- Регенерация контрактов при изменении сигнатур: упорядоченная фаза lib — `pnpm run build:lib`
  (host tsdown запускает Typert generator только на host-агрегате `tsconfig.host.json`); изменение
  тела метода регенерации не требует. Браузерный watcher подхватывает свежие generated файлы сам.
- Хостовый ряд сервиса регистрируется в том же web-app патче как обычный host-ряд
  (как plugin-inventory) + dep в web-app package.json + reference в `tsconfig.host.json`.
- Канцияельность: последний параметр хостовой сигнатуры `signal: AbortSignal` (опционально).

Решение D-RPC: использовать @Remote сервис (namespace `difExplorer`) на host-стороне, НЕ HTTP-роуты:
это документированный программный путь с генерацией строгих контрактов и диспатчем через existing gateway.

## 5. Хранилище сессий (точная схема на диске)

Расположение: `$DSH_HOME/sessions/<cwd-code>/<sessionId>/session.jsonl[.zstd]`,
где `$DSH_HOME` = `~/.dsh`, cwd-code = абсолютный cwd с `/`→`--` (края включительно): `--Volumes-Moses-IT-VideoChain--`.
Формат — JSONL: первая строка заголовок `{type:'session', version:0, id, createdAt(ms), cwd, ...}`,
далее события `{type, seq, time(ms), data}`. Физически обычно zstd-сжат (`session.jsonl.zstd`).

События тул-вызовов (проверено декодированием реальных логов):
- `tool/call` → `data:{turn, step, callId, name, arguments: <строка JSON аргументов>}`;
- `tool/result` → `data:{turn, step, message:{source:{kind:'tool', callId}, content:[{type:'tool-result', toolCallId, content:[...]}]}}`;
- `assistant/message` → `data:{turn, step, message:{content:[{type:'tool-call'|'text'|..., id, name, arguments}]}}`.

Имена мутирующих тулов в DSH (не Claude Code): `write` (`{file_path, content}`), `edit`
(`{file_path, old_string, new_string, replace_all?}`, packages/fs/tool-fs/src/edit.ts),
`str_replace_editor` (`{command: 'create'|'str_replace'|'insert', file_path, old_str?, new_str?, insert_line?}`,
packages/fs/tool-str-replace-editor). Регистронезависимо кregister mapping Edit/Write/MultiEdit→edit/write,
но штатные имена — нижний регистр.

Чтение: НЕ парсить файлы самому (zstd + формат балансировки) — host-сервис
`ctx.sessionPersistence` (packages/session/session-persistence) даёт `list(): SessionHeader[]`
(с cwd!) и `inspect(id)/load(id): {meta, events}`. Решение D-SESSCOPE: session-скоуп строится через
injection `sessionPersistence` + сканирование событий tool/call; файлы на диске не читаются напрямую.

## 6. Workspace корни

`ctx.workspaceRegistry` (packages/workspace/workspace, mount в web-app патче уже есть):
`list(): Workspace[]` (canonical path/title/id), `get(id)`, `resolveByPath(path)`. Это источник
`listRoots()`. Рабочая директория открытой сессии приходит от framework hook useSession (client)
и совпадает с canonical root воркспейса.

## 7. Git (worktree/commit скоупы)

Git не экспортирован сервисным seam'ом → backend spawn'ит read-only git-команды во workspace-корне
(execFile c массивом аргументов, пути через `--`, никакого shell):
- `git status --porcelain=v1 -z` (+ untracked внутри самого porcelain),
- `git diff --no-color HEAD -- <path>` (uncommitted против HEAD),
- `git log --name-status -z` / `git show <rev>:<path>`, `git rev-parse` и т.п.
Разрешённый список команд фиксирован кодом; остальное отказывается.

## 8. UI-примитивы и стиль

- `packages/client/ui-primitives` (baseline module table для всех динамических бандлов — value import разрешён всем):
  Button, Pill, Input, Modal, Menu, Tooltip, Toast, StateDot, DisclosureRow, HoverCard, JsonTree;
  DiffBlock существует, но это карточка tool-call (старый/новый текст столбиком, cap 16 строк) —
  недостачен для требований split/unified+line numbers+expand+hotkeys.
  Решение D-DIFFVIEW: собственный DiffViewer внутри ui-dif-explorer; из primitives переиспользуем мелочи.
- CSS: модули + семантические алиасы `--dsw-alias-*`/шрифтовые `--dsw-font-*` из ui-theme (`packages/client/ui-theme/src/styles/*`).
  Цвета диффа в DiffBlock.module.css берутся готовыми алиасами; literal цветов нет. Копирование через clsx.
- Продуктовый copy у соседей — китайский. Задача требует русскую локаль. Локальный сервис:
  типизированный overload `register(ns, { zh, en })` закрыт `LOCALE_IDS = ['zh','en'] as const`
  (settings schema union), но есть runtime overload `register(ns, locale, dict)` с произвольной строкой.
  Решение D-I18N: словари NS=`difExplorer` — полные ru + en (en fallback чейна active→en);
  ru-словарь регистрируется string-оверлоадом; глобальный язык 'ru' в locale-plugin НЕ вводим
  (широкий blast radius вне задачи).

## 9. Diff-движок

- jsdiff ^9.0.0 уже употребляется в repo (ui-trajectory, tool-fs) → зависимость `"diff": "^9.0.0"`.
  Host compute: `diffLines`/`structuredPatch` → hunk JSON; intraLine — `diffWordsWithSpace`
  лениво в браузере по видимым парам (обычная inlined dependency).
- Бинарность: эвристика non-text байтов в первых 8KB (>30% или NUL) на host.
- Лимиты: >1MB или >5000 дифф-строк → усечённый рендер (500 строк + load-more).
- «content identical»: сравнение sha256/text до отрисовки.

## 10. Безопасность

- Путь пользователя каноникализируется (fs.realpath + normalize) и обязан лежать внутри
  canonical root (prefix-check после realpath) — отказ иначе; unit-test `../../etc/passwd`.
- Никаких write-эндпоинтов; spawn только white-list git read команд; секреты (.env*, *.pem, *.key, id_rsa*…)
  маскируются на host (`sk-…`, PEM blocks и `KEY=value` подсвечиваются как ***).
- Политика чтения файлов: собственный canonicalize поверх node:fs — плагин host-plane, workspace root получен
  из workspaceRegistry (trusted source).

## Итоговые решения (однострочные, поменять можно только записью сюда)

1. D-RPC: host @Remote сервис namespace `difExplorer` в новом пакете `packages/host/dif-explorer`
   (`@deepseek-ai/dsh-dif-explorer`), монтаж через api-remotes client index.
2. D-SESSCOPE: чтение журналов только через `ctx.sessionPersistence`; ничего не парсим с диска сами.
3. D-ROOTS: корни — `workspaceRegistry.list()`; rootId = branded WorkspaceId.
4. D-TREE: дерево файлов — `git ls-files --cached --others --exclude-standard -z` (уважает .gitignore),
   безопасный fallback — рекурсивный walk c .gitignore parsing'ом нет (v2); отсутствие git → только walk верхнего уровня.
5. D-DIFFVIEW: свой DiffViewer (split/unified/expand/hotkeys) вместо primitives DiffBlock.
6. D-I18N: NS `difExplorer`, полный ru + en словари; системный локаль-плагин не расширяю.
7. D-GITSEC: execFile(массив argv) + белый список команд + `--` перед путями; no shell.
8. D-BRANCH: ветка feat/dif-explorer от master; атомарные коммиты, финальный squash-PR.
