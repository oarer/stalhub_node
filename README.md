# stalhub_node

Stateless исполнитель запросов к StalCraft eAPI для [stalhub_backend](https://github.com/oarer/stalhub_backend).

Как это работает: запрос приходит на бэкенд, бэкенд выбирает токен со свободной квотой (200 использований/мин, auction-роуты стоят 2) и пересылает запрос сюда. Нода делает сырой HTTPS-вызов в eAPI и возвращает конверт `{ status, data }`. Токены хранятся только на бэкенде, нода их не хранит и не логирует.

## Быстрый старт

```bash
cp .env.example .env
# поправь SC_NODE_SECRET в .env
bun install
bun run src/server.ts
# или: bun run dev (watch), docker compose up -d --build
```

Проверка: `curl localhost:3101/health` → `{"ok":true,"node":"node-1"}`.

## Env

| Переменная | Default | Назначение |
|---|---|---|
| `PORT` | `3101` | Порт |
| `NODE_NAME` | `node` | Имя для логов и `/health` |
| `SC_NODE_SECRET` | `` | Bearer-секрет. Бэкенд хранит его как `api_key` ноды. Пусто = без авторизации (только для dev) |
| `EAPI_BASE_URL` | `https://eapi.stalcraft.net` | Апстрим |
| `EAPI_TIMEOUT_MS` | `15000` | Таймаут запроса к апстриму |
| `LOG_REQUESTS` | `false` | Логировать каждый запрос (метод, путь, статус, время; токен никогда не логируется) |

## Протокол

### `GET /health`

```json
{ "ok": true, "node": "node-1" }
```

Используется кнопкой Ping в админке бэкенда (`POST /api/v1/admin/sc/nodes/:id/ping`).

### `POST /sc/execute`

Auth: `Authorization: Bearer <SC_NODE_SECRET>` (если секрет задан).

Тело:

```json
{
	"method": "GET",
	"path": "/RU/auction/abc123/lots",
	"params": { "limit": 10, "offset": 0 },
	"data": null,
	"token": "<stalcraft api token>"
}
```

Ответ — всегда транспортный status 200, статус eAPI внутри конверта:

```json
{ "status": 200, "data": { "...": "..." } }
```

Ошибки уровня ноды (нет сети до eAPI, плохой запрос) — транспортные `400`/`401`/`404`/`502`. Бэкенд при транспортной ошибке помечает ноду и уходит на следующую.

## Регистрация в бэкенде

Админка бэкенда (`/api/v1/admin/sc/nodes`):

```json
{
	"name": "node-1",
	"base_url": "http://node-1:3101",
	"api_key": "<тот же SC_NODE_SECRET>",
	"priority": 10
}
```

`api_key` хранится в БД бэкенда в шифрованном виде и никуда не возвращается в API.

## Масштабирование

1. Подними N нод (`docker compose up -d --build` для одной; для нескольких — продублируй сервис в `docker-compose.yml` с другим именем/портом). Для реального прироста квоты ноды должны сидеть на **разных egress-IP** (отдельные VPS/NAT) — иначе это только отказоустойчивость.
2. Зарегистрируй каждую ноду в админке бэкенда.
3. Бэкенд раздаёт запросы round-robin с учётом `priority`, токены общие для всех нод.

Оценка пропускной способности: `токены × 200 req/min` (auction-запросы ×2). Квота считается на бэкенде, ноды stateless — их можно убивать и поднимать без последствий.

## Мониторинг

- Healthcheck в `Dockerfile` и `docker-compose.yml` — `GET /health`.
- `LOG_REQUESTS=true` — краткий access-лог без секретов.
- Метрики пула (`sc_gateway_requests_total{node,...}`) — на стороне бэкенда в `/metrics`.

## License

GPL-3.0-only, как и stalhub_backend.
