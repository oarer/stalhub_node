// StalHub SC node worker: stateless executor for eAPI StalCraft requests.
//
// The backend (gateway) picks a token with free quota and forwards
// the request here. The node performs the raw HTTPS call to the
// eAPI base URL and returns the envelope { status, data }.
//
// Env:
//   PORT              - listen port (default 3101)
//   NODE_NAME         - human-readable name for logs (default "node")
//   SC_NODE_SECRET    - bearer secret; backend stores it per-node as api_key.
//                       Empty = no auth (dev only, never use in production)
//   EAPI_BASE_URL     - upstream API (default https://eapi.stalcraft.net)
//   EAPI_TIMEOUT_MS   - upstream request timeout (default 15000)
//   LOG_REQUESTS      - "true" to log every executed request (default "false";
//                       the token value is NEVER logged)

const PORT = Number(process.env.PORT ?? 3101)
const NODE_NAME = process.env.NODE_NAME ?? 'node'
const SECRET = process.env.SC_NODE_SECRET ?? ''
const EAPI = (process.env.EAPI_BASE_URL ?? 'https://eapi.stalcraft.net').replace(
	/\/+$/,
	''
)
const EAPI_TIMEOUT_MS = Number(process.env.EAPI_TIMEOUT_MS ?? 15_000)
const LOG_REQUESTS = process.env.LOG_REQUESTS === 'true'

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function log(...args: unknown[]): void {
	console.log(`[${NODE_NAME}]`, ...args)
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

interface ExecuteBody {
	method?: string
	path?: string
	params?: Record<string, unknown>
	data?: unknown
	token?: string
}

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url)

		if (req.method === 'GET' && url.pathname === '/health') {
			return json(200, { ok: true, node: NODE_NAME })
		}

		if (req.method !== 'POST' || url.pathname !== '/sc/execute') {
			return json(404, { error: 'Not found' })
		}

		if (SECRET) {
			const auth = req.headers.get('authorization') ?? ''
			if (auth !== `Bearer ${SECRET}`) {
				return json(401, { error: 'Invalid node secret' })
			}
		}

		let body: ExecuteBody
		try {
			body = (await req.json()) as ExecuteBody
		} catch {
			return json(400, { error: 'Invalid JSON body' })
		}

		const method = (body.method ?? 'GET').toUpperCase()
		const path = body.path ?? ''
		if (!ALLOWED_METHODS.has(method)) {
			return json(400, { error: `Method ${method} not allowed` })
		}
		if (!path.startsWith('/') || path.includes('..')) {
			return json(400, { error: 'Invalid path' })
		}
		if (!body.token) {
			return json(400, { error: 'Token is required' })
		}

		const target = new URL(EAPI + path)
		if (body.params && typeof body.params === 'object') {
			for (const [k, v] of Object.entries(body.params)) {
				if (v !== undefined && v !== null) {
					target.searchParams.set(k, String(v))
				}
			}
		}

		const started = Date.now()
		try {
			const res = await fetch(target, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${body.token}`,
				},
				body:
					method === 'GET' || body.data == null
						? undefined
						: JSON.stringify(body.data),
				signal: AbortSignal.timeout(EAPI_TIMEOUT_MS),
			})
			const data = await res.json().catch(() => null)
			if (LOG_REQUESTS) {
				log(method, path, '->', res.status, `${Date.now() - started}ms`)
			}
			// Always 200 transport-level: eAPI status lives in the envelope.
			return json(200, { status: res.status, data })
		} catch (error) {
			log('eAPI request failed:', error instanceof Error ? error.message : error)
			return json(502, {
				error: 'eAPI request failed',
				details: error instanceof Error ? error.message : 'unknown',
			})
		}
	},
})

if (!SECRET) {
	log('WARNING: SC_NODE_SECRET is empty, node auth is disabled (dev only)')
}
log(`listening on :${PORT}, upstream ${EAPI}`)
